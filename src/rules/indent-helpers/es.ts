import type { AST } from "svelte-eslint-parser"
import type * as ESTree from "estree"
import type { TSESTree } from "@typescript-eslint/types"
import type { ASTNode } from "../../types"
import type { IndentContext } from "./commons"
import { getFirstAndLastTokens } from "./commons"
import {
  isArrowToken,
  isClosingBraceToken,
  isClosingBracketToken,
  isClosingParenToken,
  isNotClosingParenToken,
  isNotOpeningParenToken,
  isOpeningBraceToken,
  isOpeningBracketToken,
  isOpeningParenToken,
  isSemicolonToken,
} from "eslint-utils"

type NodeWithParent =
  | (Exclude<ESTree.Node, ESTree.Program> & { parent: ASTNode })
  | AST.SvelteProgram
  | AST.SvelteReactiveStatement

type NodeListener = {
  [key in NodeWithParent["type"]]: (
    node: NodeWithParent & { type: key },
  ) => void
}

/**
 * Creates AST event handlers for ES nodes.
 *
 * @param context The rule context.
 * @returns AST event handlers.
 */
export function defineVisitor(context: IndentContext): NodeListener {
  const { sourceCode, offsets, options } = context

  /**
   * Find the root of left node.
   */
  function getRootLeft(
    node:
      | ESTree.AssignmentExpression
      | ESTree.AssignmentPattern
      | ESTree.BinaryExpression
      | ESTree.LogicalExpression,
  ) {
    let target = node
    let parent = getParent(target)
    while (
      parent &&
      (parent.type === "AssignmentExpression" ||
        parent.type === "AssignmentPattern" ||
        parent.type === "BinaryExpression" ||
        parent.type === "LogicalExpression")
    ) {
      const prevToken = sourceCode.getTokenBefore(target)
      if (prevToken && isOpeningParenToken(prevToken)) {
        break
      }
      target = parent
      parent = getParent(target)
    }
    return target.left
  }

  const visitor = {
    Program(node: AST.SvelteProgram) {
      for (const body of node.body) {
        if (body.type === "SvelteText" && !body.value.trim()) {
          continue
        }
        offsets.setStartOffsetToken(sourceCode.getFirstToken(body), 0)
      }
    },
    ArrayExpression(node: ESTree.ArrayExpression | ESTree.ArrayPattern) {
      const firstToken = sourceCode.getFirstToken(node)
      const rightToken = sourceCode.getTokenAfter(
        node.elements[node.elements.length - 1] || firstToken,
        { filter: isClosingBracketToken, includeComments: false },
      )
      offsets.setOffsetElementList(node.elements, firstToken, rightToken, 1)
    },
    ArrayPattern(node: ESTree.ArrayPattern) {
      visitor.ArrayExpression(node)
    },
    ArrowFunctionExpression(node: ESTree.ArrowFunctionExpression) {
      const [firstToken, secondToken] = sourceCode.getFirstTokens(node, {
        count: 2,
        includeComments: false,
      })
      const leftToken = node.async ? secondToken : firstToken
      const arrowToken = sourceCode.getTokenBefore(node.body, {
        filter: isArrowToken,
        includeComments: false,
      })

      if (node.async) {
        offsets.setOffsetToken(secondToken, 1, firstToken)
      }
      if (isOpeningParenToken(leftToken)) {
        const rightToken = sourceCode.getTokenAfter(
          node.params[node.params.length - 1] || leftToken,
          { filter: isClosingParenToken, includeComments: false },
        )
        offsets.setOffsetElementList(node.params, leftToken, rightToken, 1)
      }

      offsets.setOffsetToken(arrowToken, 1, firstToken)

      const bodyFirstToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(
        bodyFirstToken,
        isOpeningBraceToken(bodyFirstToken) ? 0 : 1,
        firstToken,
      )
    },
    AssignmentExpression(
      node:
        | ESTree.AssignmentExpression
        | ESTree.AssignmentPattern
        | ESTree.BinaryExpression
        | ESTree.LogicalExpression,
    ) {
      const leftNode = getRootLeft(node)
      const opToken = sourceCode.getTokenAfter(node.left, {
        filter: isNotClosingParenToken,
        includeComments: false,
      })!
      const rightToken = getFirstAndLastTokens(
        sourceCode,
        node.right,
      ).firstToken

      offsets.setOffsetToken(
        [opToken, rightToken],
        1,
        getFirstAndLastTokens(sourceCode, leftNode).firstToken,
      )
    },
    AssignmentPattern(node: ESTree.AssignmentPattern) {
      visitor.AssignmentExpression(node)
    },
    BinaryExpression(node: ESTree.BinaryExpression) {
      visitor.AssignmentExpression(node)
    },
    LogicalExpression(node: ESTree.LogicalExpression) {
      visitor.AssignmentExpression(node)
    },
    AwaitExpression(
      node:
        | ESTree.AwaitExpression
        | ESTree.RestElement
        | ESTree.SpreadElement
        | ESTree.UnaryExpression,
    ) {
      // `await`, `...`, or UnaryOperator
      const firstToken = sourceCode.getFirstToken(node)
      const nextToken = sourceCode.getTokenAfter(firstToken)

      offsets.setOffsetToken(nextToken, 1, firstToken)
    },
    RestElement(node: ESTree.RestElement) {
      visitor.AwaitExpression(node)
    },
    SpreadElement(node: ESTree.SpreadElement) {
      visitor.AwaitExpression(node)
    },
    UnaryExpression(node: ESTree.UnaryExpression) {
      visitor.AwaitExpression(node)
    },
    BlockStatement(node: ESTree.BlockStatement | ESTree.ClassBody) {
      offsets.setOffsetElementList(
        node.body,
        sourceCode.getFirstToken(node),
        sourceCode.getLastToken(node),
        1,
      )
    },
    ClassBody(node: ESTree.ClassBody) {
      visitor.BlockStatement(node)
    },
    BreakStatement(node: ESTree.BreakStatement | ESTree.ContinueStatement) {
      if (node.label) {
        const firstToken = sourceCode.getFirstToken(node)
        const nextToken = sourceCode.getTokenAfter(firstToken)

        offsets.setOffsetToken(nextToken, 1, firstToken)
      }
    },
    ContinueStatement(node: ESTree.ContinueStatement) {
      visitor.BreakStatement(node)
    },
    CallExpression(node: ESTree.CallExpression) {
      const firstToken = sourceCode.getFirstToken(node)
      const leftParenToken = sourceCode.getTokenAfter(node.callee, {
        filter: isOpeningParenToken,
        includeComments: false,
      })!
      const rightParenToken = sourceCode.getLastToken(node)

      for (const optionalToken of sourceCode.getTokensBetween(
        sourceCode.getLastToken(node.callee),
        leftParenToken,
        { filter: isOptionalToken, includeComments: false },
      )) {
        offsets.setOffsetToken(optionalToken, 1, firstToken)
      }

      offsets.setOffsetToken(leftParenToken, 1, firstToken)
      offsets.setOffsetElementList(
        node.arguments,
        leftParenToken,
        rightParenToken,
        1,
      )
    },
    CatchClause(node: ESTree.CatchClause) {
      const catchToken = sourceCode.getFirstToken(node)

      if (node.param != null) {
        const leftParenToken = sourceCode.getTokenBefore(node.param)!
        const rightParenToken = sourceCode.getTokenAfter(node.param)

        offsets.setOffsetToken(leftParenToken, 1, catchToken)
        offsets.setOffsetElementList(
          [node.param],
          leftParenToken,
          rightParenToken,
          1,
        )
      }
      const bodyToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(bodyToken, 0, catchToken)
    },
    ClassDeclaration(node: ESTree.ClassDeclaration | ESTree.ClassExpression) {
      const classToken = sourceCode.getFirstToken(node)

      if (node.id != null) {
        offsets.setOffsetToken(sourceCode.getFirstToken(node.id), 1, classToken)
      }
      if (node.superClass != null) {
        const extendsToken = sourceCode.getTokenBefore(node.superClass)!
        const superClassToken = sourceCode.getTokenAfter(extendsToken)
        offsets.setOffsetToken(extendsToken, 1, classToken)
        offsets.setOffsetToken(superClassToken, 1, extendsToken)
      }
      const bodyToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(bodyToken, 0, classToken)
    },
    ClassExpression(node: ESTree.ClassExpression) {
      visitor.ClassDeclaration(node)
    },
    ConditionalExpression(node: ESTree.ConditionalExpression) {
      const questionToken = sourceCode.getTokenAfter(node.test, {
        filter: isNotClosingParenToken,
        includeComments: false,
      })!

      const consequentToken = sourceCode.getTokenAfter(questionToken)
      const colonToken = sourceCode.getTokenAfter(node.consequent, {
        filter: isNotClosingParenToken,
        includeComments: false,
      })!
      const alternateToken = sourceCode.getTokenAfter(colonToken)

      let baseNode = node
      let parent = getParent(baseNode)
      while (
        parent &&
        parent.type === "ConditionalExpression" &&
        parent.alternate === baseNode
      ) {
        baseNode = parent
        parent = getParent(baseNode)
      }
      const baseToken = sourceCode.getFirstToken(baseNode)

      offsets.setOffsetToken([questionToken, colonToken], 1, baseToken)
      offsets.setOffsetToken(consequentToken, 1, questionToken)
      offsets.setOffsetToken(alternateToken, 1, colonToken)
    },
    DoWhileStatement(node: ESTree.DoWhileStatement) {
      const doToken = sourceCode.getFirstToken(node)
      const whileToken = sourceCode.getTokenAfter(node.body, {
        filter: isNotClosingParenToken,
        includeComments: false,
      })!
      const leftParenToken = sourceCode.getTokenAfter(whileToken)!
      const rightParenToken = sourceCode.getTokenAfter(node.test)!

      const bodyFirstToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(
        bodyFirstToken,
        isOpeningBraceToken(bodyFirstToken) ? 0 : 1,
        doToken,
      )

      offsets.setOffsetToken(whileToken, 0, doToken)
      offsets.setOffsetToken(leftParenToken, 1, whileToken)
      offsets.setOffsetElementList(
        [node.test],
        leftParenToken,
        rightParenToken,
        1,
      )
    },
    ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
      const exportToken = sourceCode.getFirstToken(node)
      const tokens = sourceCode.getTokensBetween(exportToken, node.source)
      const fromIndex = tokens.findIndex((t) => t.value === "from")
      const fromToken = tokens[fromIndex]
      const beforeTokens = tokens.slice(0, fromIndex)
      const afterTokens = [
        ...tokens.slice(fromIndex + 1),
        sourceCode.getFirstToken(node.source),
      ]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type bug?
      if (!(node as any).exported) {
        // export * from "mod"
        offsets.setOffsetToken(beforeTokens, 1, exportToken)
      } else {
        // export * as foo from "mod"
        const asIndex = beforeTokens.findIndex((t) => t.value === "as")
        offsets.setOffsetToken(beforeTokens.slice(0, asIndex), 1, exportToken)
        offsets.setOffsetToken(
          beforeTokens.slice(asIndex),
          1,
          beforeTokens[asIndex - 1],
        )
      }
      offsets.setOffsetToken(fromToken, 0, exportToken)
      offsets.setOffsetToken(afterTokens, 1, fromToken)
    },
    ExportDefaultDeclaration(node: ESTree.ExportDefaultDeclaration) {
      const exportToken = sourceCode.getFirstToken(node)
      const declarationToken = getFirstAndLastTokens(
        sourceCode,
        node.declaration,
      ).firstToken
      const defaultTokens = sourceCode.getTokensBetween(
        exportToken,
        declarationToken,
      )
      offsets.setOffsetToken(
        [...defaultTokens, declarationToken],
        1,
        exportToken,
      )
    },
    ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
      const exportToken = sourceCode.getFirstToken(node)
      if (node.declaration) {
        // export var foo = 1;
        const declarationToken = sourceCode.getFirstToken(node.declaration)
        offsets.setOffsetToken(declarationToken, 1, exportToken)
      } else {
        const firstSpecifier = node.specifiers[0]
        if (!firstSpecifier || firstSpecifier.type === "ExportSpecifier") {
          // export {foo, bar}; or export {foo, bar} from "mod";
          const leftBraceTokens = sourceCode.getTokensBetween(
            exportToken,
            firstSpecifier,
          )
          const rightBraceToken = sourceCode.getLastToken(node, {
            filter: isClosingBraceToken,
            includeComments: false,
          })!
          offsets.setOffsetToken(leftBraceTokens, 0, exportToken)
          offsets.setOffsetElementList(
            node.specifiers,
            leftBraceTokens[leftBraceTokens.length - 1],
            rightBraceToken,
            1,
          )

          if (node.source) {
            const [fromToken, ...tokens] = sourceCode.getTokensBetween(
              rightBraceToken,
              node.source,
            )

            offsets.setOffsetToken(fromToken, 0, exportToken)
            offsets.setOffsetToken(
              [...tokens, sourceCode.getFirstToken(node.source)],
              1,
              fromToken,
            )
          }
        } else {
          // maybe babel-eslint
        }
      }
    },
    ExportSpecifier(node: ESTree.ExportSpecifier) {
      const [firstToken, ...tokens] = sourceCode.getTokens(node)
      offsets.setOffsetToken(tokens, 1, firstToken)
    },
    ForInStatement(node: ESTree.ForInStatement | ESTree.ForOfStatement) {
      const forToken = sourceCode.getFirstToken(node)
      const awaitToken =
        (node.type === "ForOfStatement" &&
          node.await &&
          sourceCode.getTokenAfter(forToken)) ||
        null
      const leftParenToken = sourceCode.getTokenAfter(awaitToken || forToken)!
      const leftToken = sourceCode.getFirstToken(node.left)
      const inOrOfToken = sourceCode.getTokenAfter(node.left, {
        filter: isNotClosingParenToken,
        includeComments: false,
      })!
      const rightToken = sourceCode.getTokenAfter(inOrOfToken)
      const rightParenToken = sourceCode.getTokenBefore(node.body, {
        filter: isNotOpeningParenToken,
        includeComments: false,
      })!

      if (awaitToken != null) {
        offsets.setOffsetToken(awaitToken, 0, forToken)
      }
      offsets.setOffsetToken(leftParenToken, 1, forToken)
      offsets.setOffsetToken(leftToken, 1, leftParenToken)
      offsets.setOffsetToken([inOrOfToken, rightToken], 1, leftToken)
      offsets.setOffsetToken(rightParenToken, 0, leftParenToken)

      const bodyFirstToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(
        bodyFirstToken,
        isOpeningBraceToken(bodyFirstToken) ? 0 : 1,
        forToken,
      )
    },
    ForOfStatement(node: ESTree.ForOfStatement) {
      visitor.ForInStatement(node)
    },
    ForStatement(node: ESTree.ForStatement) {
      const forToken = sourceCode.getFirstToken(node)
      const leftParenToken = sourceCode.getTokenAfter(forToken)!
      const rightParenToken = sourceCode.getTokenBefore(node.body, {
        filter: isNotOpeningParenToken,
        includeComments: false,
      })

      offsets.setOffsetToken(leftParenToken, 1, forToken)
      offsets.setOffsetElementList(
        [node.init, node.test, node.update],
        leftParenToken,
        rightParenToken,
        1,
      )

      const bodyFirstToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(
        bodyFirstToken,
        isOpeningBraceToken(bodyFirstToken) ? 0 : 1,
        forToken,
      )
    },
    FunctionDeclaration(
      node: ESTree.FunctionDeclaration | ESTree.FunctionExpression,
    ) {
      const firstToken = sourceCode.getFirstToken(node)

      const leftParenToken = sourceCode.getTokenBefore(
        node.params[0] ||
          (node as TSESTree.FunctionExpression).returnType ||
          sourceCode.getTokenBefore(node.body),
        {
          filter: isOpeningParenToken,
          includeComments: false,
        },
      )!
      let bodyBaseToken
      if (firstToken.type === "Punctuator") {
        // method
        bodyBaseToken = sourceCode.getFirstToken(getParent(node)!)
      } else {
        let tokenOffset = 0
        for (const token of sourceCode.getTokensBetween(
          firstToken,
          leftParenToken,
        )) {
          if (token.value === "<") {
            break
          }
          if (
            token.value === "*" ||
            (node.id && token.range[0] === node.id.range![0])
          ) {
            tokenOffset = 1
          }
          offsets.setOffsetToken(token, tokenOffset, firstToken)
        }

        bodyBaseToken = firstToken
      }

      const rightParenToken = sourceCode.getTokenAfter(
        node.params[node.params.length - 1] || leftParenToken,
        { filter: isClosingParenToken, includeComments: false },
      )!
      offsets.setOffsetToken(leftParenToken, 1, bodyBaseToken)
      offsets.setOffsetElementList(
        node.params,
        leftParenToken,
        rightParenToken,
        1,
      )

      const bodyToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(bodyToken, 0, bodyBaseToken)
    },
    FunctionExpression(node: ESTree.FunctionExpression) {
      visitor.FunctionDeclaration(node)
    },
    IfStatement(node: ESTree.IfStatement) {
      const [ifToken, ifLeftParenToken] = sourceCode.getFirstTokens(node, {
        count: 2,
        includeComments: false,
      })
      const ifRightParenToken = sourceCode.getTokenBefore(node.consequent, {
        filter: isClosingParenToken,
        includeComments: false,
      })

      offsets.setOffsetToken(ifLeftParenToken, 1, ifToken)
      offsets.setOffsetToken(ifRightParenToken, 0, ifLeftParenToken)

      const consequentFirstToken = sourceCode.getFirstToken(node.consequent)
      offsets.setOffsetToken(
        consequentFirstToken,
        isOpeningBraceToken(consequentFirstToken) ? 0 : 1,
        ifToken,
      )

      if (node.alternate != null) {
        const elseToken = sourceCode.getTokenAfter(node.consequent, {
          filter: isNotClosingParenToken,
          includeComments: false,
        })!

        offsets.setOffsetToken(elseToken, 0, ifToken)

        const alternateFirstToken = sourceCode.getFirstToken(node.alternate)
        offsets.setOffsetToken(
          alternateFirstToken,
          isOpeningBraceToken(alternateFirstToken) ? 0 : 1,
          elseToken,
        )
      }
    },
    ImportDeclaration(node: ESTree.ImportDeclaration) {
      const importToken = sourceCode.getFirstToken(node)
      const tokens = sourceCode.getTokensBetween(importToken, node.source)
      const fromIndex = tokens.map((t) => t.value).lastIndexOf("from")
      const { fromToken, beforeTokens, afterTokens } =
        fromIndex >= 0
          ? {
              fromToken: tokens[fromIndex],
              beforeTokens: tokens.slice(0, fromIndex),
              afterTokens: [
                ...tokens.slice(fromIndex + 1),
                sourceCode.getFirstToken(node.source),
              ],
            }
          : {
              fromToken: null,
              beforeTokens: [...tokens, sourceCode.getFirstToken(node.source)],
              afterTokens: [],
            }

      const namedSpecifiers: ESTree.ImportSpecifier[] = []
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") {
          namedSpecifiers.push(specifier)
        } else {
          const removeTokens = sourceCode.getTokens(specifier)
          removeTokens.shift()
          for (const token of removeTokens) {
            const i = beforeTokens.indexOf(token)
            if (i >= 0) {
              beforeTokens.splice(i, 1)
            }
          }
        }
      }
      if (namedSpecifiers.length) {
        const leftBrace = sourceCode.getTokenBefore(namedSpecifiers[0])!
        const rightBrace = sourceCode.getTokenAfter(
          namedSpecifiers[namedSpecifiers.length - 1],
          { filter: isClosingBraceToken, includeComments: false },
        )!
        offsets.setOffsetElementList(namedSpecifiers, leftBrace, rightBrace, 1)
        for (const token of sourceCode.getTokensBetween(
          leftBrace,
          rightBrace,
        )) {
          const i = beforeTokens.indexOf(token)
          if (i >= 0) {
            beforeTokens.splice(i, 1)
          }
        }
      }

      if (
        beforeTokens.every(
          (t) => isOpeningBraceToken(t) || isClosingBraceToken(t),
        )
      ) {
        offsets.setOffsetToken(beforeTokens, 0, importToken)
      } else {
        offsets.setOffsetToken(beforeTokens, 1, importToken)
      }
      if (fromToken) {
        offsets.setOffsetToken(fromToken, 0, importToken)
        offsets.setOffsetToken(afterTokens, 1, fromToken)
      }
    },
    ImportExpression(node: ESTree.ImportExpression) {
      const firstToken = sourceCode.getFirstToken(node)
      const rightToken = sourceCode.getLastToken(node)
      const leftToken = sourceCode.getTokenAfter(firstToken, {
        filter: isOpeningParenToken,
        includeComments: false,
      })!

      offsets.setOffsetToken(leftToken, 1, firstToken)
      offsets.setOffsetElementList([node.source], leftToken, rightToken, 1)
    },
    ImportNamespaceSpecifier(node: ESTree.ImportNamespaceSpecifier) {
      const tokens = sourceCode.getTokens(node)
      const firstToken = tokens.shift()!
      offsets.setOffsetToken(tokens, 1, firstToken)
    },
    ImportSpecifier(node: ESTree.ImportSpecifier) {
      if (node.local.range![0] !== node.imported.range![0]) {
        const tokens = sourceCode.getTokens(node)
        const firstToken = tokens.shift()!
        offsets.setOffsetToken(tokens, 1, firstToken)
      }
    },
    LabeledStatement(
      node: ESTree.LabeledStatement | AST.SvelteReactiveStatement,
    ) {
      const labelToken = sourceCode.getFirstToken(node)
      const colonToken = sourceCode.getTokenAfter(labelToken)!
      const bodyToken = sourceCode.getTokenAfter(colonToken)

      offsets.setOffsetToken([colonToken, bodyToken], 1, labelToken)
    },
    SvelteReactiveStatement(node: AST.SvelteReactiveStatement) {
      visitor.LabeledStatement(node)
    },
    MemberExpression(node: ESTree.MemberExpression | ESTree.MetaProperty) {
      const objectToken = sourceCode.getFirstToken(node)
      if (node.type === "MemberExpression" && node.computed) {
        const leftBracketToken = sourceCode.getTokenBefore(node.property, {
          filter: isOpeningBracketToken,
          includeComments: false,
        })!
        const rightBracketToken = sourceCode.getTokenAfter(node.property, {
          filter: isClosingBracketToken,
          includeComments: false,
        })

        for (const optionalToken of sourceCode.getTokensBetween(
          sourceCode.getLastToken(node.object),
          leftBracketToken,
          { filter: isOptionalToken, includeComments: false },
        )) {
          offsets.setOffsetToken(optionalToken, 1, objectToken)
        }

        offsets.setOffsetToken(leftBracketToken, 1, objectToken)
        offsets.setOffsetElementList(
          [node.property],
          leftBracketToken,
          rightBracketToken,
          1,
        )
      } else {
        const dotToken = sourceCode.getTokenBefore(node.property)!
        const propertyToken = sourceCode.getTokenAfter(dotToken)

        offsets.setOffsetToken([dotToken, propertyToken], 1, objectToken)
      }
    },
    MetaProperty(node: ESTree.MetaProperty) {
      visitor.MemberExpression(node)
    },
    MethodDefinition(
      node:
        | ESTree.MethodDefinition
        | ESTree.Property
        | ESTree.PropertyDefinition,
    ) {
      const firstToken = sourceCode.getFirstToken(node)
      const keyTokens = getFirstAndLastTokens(sourceCode, node.key)
      const prefixTokens = sourceCode.getTokensBetween(
        firstToken,
        keyTokens.firstToken,
      )
      if (node.computed) {
        prefixTokens.pop() // pop [
      }
      offsets.setOffsetToken(prefixTokens, 0, firstToken)

      let lastKeyToken
      if (node.computed) {
        const leftBracketToken = sourceCode.getTokenBefore(
          keyTokens.firstToken,
        )!
        const rightBracketToken = (lastKeyToken = sourceCode.getTokenAfter(
          keyTokens.lastToken,
        )!)
        offsets.setOffsetToken(leftBracketToken, 0, firstToken)
        offsets.setOffsetElementList(
          [node.key],
          leftBracketToken,
          rightBracketToken,
          1,
        )
      } else {
        offsets.setOffsetToken(keyTokens.firstToken, 0, firstToken)
        lastKeyToken = keyTokens.lastToken
      }

      if (node.value) {
        const initToken = sourceCode.getFirstToken(node.value)
        offsets.setOffsetToken(
          [...sourceCode.getTokensBetween(lastKeyToken, initToken), initToken],
          1,
          lastKeyToken,
        )
      }
    },
    Property(node: ESTree.Property) {
      visitor.MethodDefinition(node)
    },
    NewExpression(node: ESTree.NewExpression) {
      const newToken = sourceCode.getFirstToken(node)
      const calleeTokens = getFirstAndLastTokens(sourceCode, node.callee)
      offsets.setOffsetToken(calleeTokens.firstToken, 1, newToken)

      if (
        node.arguments.length ||
        calleeTokens.lastToken.range[1] < node.range![1]
      ) {
        const rightParenToken = sourceCode.getLastToken(node)
        const leftParenToken = sourceCode.getTokenAfter(calleeTokens.lastToken)!

        offsets.setOffsetToken(leftParenToken, 1, calleeTokens.firstToken)
        offsets.setOffsetElementList(
          node.arguments,
          leftParenToken,
          rightParenToken,
          1,
        )
      }
    },
    ObjectExpression(node: ESTree.ObjectExpression | ESTree.ObjectPattern) {
      const firstToken = sourceCode.getFirstToken(node)
      const rightToken = sourceCode.getTokenAfter(
        node.properties[node.properties.length - 1] || firstToken,
        { filter: isClosingBraceToken, includeComments: false },
      )
      offsets.setOffsetElementList(node.properties, firstToken, rightToken, 1)
    },
    ObjectPattern(node: ESTree.ObjectPattern) {
      visitor.ObjectExpression(node)
    },
    PropertyDefinition(node: ESTree.PropertyDefinition) {
      visitor.MethodDefinition(node)
    },
    ReturnStatement(node: ESTree.ReturnStatement | ESTree.ThrowStatement) {
      if (node.argument) {
        const firstToken = sourceCode.getFirstToken(node)
        const nextToken = sourceCode.getTokenAfter(firstToken)

        offsets.setOffsetToken(nextToken, 1, firstToken)
      }
    },
    ThrowStatement(node: ESTree.ThrowStatement) {
      visitor.ReturnStatement(node)
    },
    SequenceExpression(node: ESTree.SequenceExpression) {
      const firstToken = sourceCode.getFirstToken(node)
      offsets.setOffsetElementList(node.expressions, firstToken, null, 0)
    },
    SwitchCase(node: ESTree.SwitchCase) {
      const caseToken = sourceCode.getFirstToken(node)
      if (node.test != null) {
        const testTokens = getFirstAndLastTokens(sourceCode, node.test)
        const colonToken = sourceCode.getTokenAfter(testTokens.lastToken)
        offsets.setOffsetToken(
          [testTokens.firstToken, colonToken],
          1,
          caseToken,
        )
      } else {
        const colonToken = sourceCode.getTokenAfter(caseToken)
        offsets.setOffsetToken(colonToken, 1, caseToken)
      }

      if (
        node.consequent.length === 1 &&
        node.consequent[0].type === "BlockStatement"
      ) {
        offsets.setOffsetToken(
          sourceCode.getFirstToken(node.consequent[0]),
          0,
          caseToken,
        )
      } else {
        for (const statement of node.consequent) {
          offsets.setOffsetToken(
            getFirstAndLastTokens(sourceCode, statement).firstToken,
            1,
            caseToken,
          )
        }
      }
    },
    SwitchStatement(node: ESTree.SwitchStatement) {
      const switchToken = sourceCode.getFirstToken(node)
      const { firstToken: leftParenToken, lastToken: rightParenToken } =
        getFirstAndLastTokens(sourceCode, node.discriminant)
      const leftBraceToken = sourceCode.getTokenAfter(rightParenToken)!
      const rightBraceToken = sourceCode.getLastToken(node)

      offsets.setOffsetToken(leftParenToken, 1, switchToken)
      offsets.setOffsetElementList(
        [node.discriminant],
        leftParenToken,
        rightParenToken,
        1,
      )
      offsets.setOffsetToken(leftBraceToken, 0, switchToken)
      offsets.setOffsetElementList(
        node.cases,
        leftBraceToken,
        rightBraceToken,
        options.switchCase,
      )
    },
    TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression) {
      const tagTokens = getFirstAndLastTokens(sourceCode, node.tag)
      offsets.setOffsetToken(
        sourceCode.getFirstToken(node.quasi),
        1,
        tagTokens.firstToken,
      )
    },
    TemplateLiteral(node: ESTree.TemplateLiteral) {
      const firstToken = sourceCode.getFirstToken(node)
      const quasiTokens = node.quasis
        .slice(1)
        .map((n) => sourceCode.getFirstToken(n))
      const expressionToken = node.quasis
        .slice(0, -1)
        .map((n) => sourceCode.getTokenAfter(n))

      offsets.setOffsetToken(quasiTokens, 0, firstToken)
      offsets.setOffsetToken(expressionToken, 1, firstToken)
    },
    TryStatement(node: ESTree.TryStatement) {
      const tryToken = sourceCode.getFirstToken(node)
      const tryBlockToken = sourceCode.getFirstToken(node.block)

      offsets.setOffsetToken(tryBlockToken, 0, tryToken)

      if (node.handler != null) {
        const catchToken = sourceCode.getFirstToken(node.handler)
        offsets.setOffsetToken(catchToken, 0, tryToken)
      }

      if (node.finalizer != null) {
        const finallyToken = sourceCode.getTokenBefore(node.finalizer)
        const finallyBlockToken = sourceCode.getFirstToken(node.finalizer)
        offsets.setOffsetToken([finallyToken, finallyBlockToken], 0, tryToken)
      }
    },
    UpdateExpression(node: ESTree.UpdateExpression) {
      const firstToken = sourceCode.getFirstToken(node)
      const nextToken = sourceCode.getTokenAfter(firstToken)
      offsets.setOffsetToken(nextToken, 1, firstToken)
    },
    VariableDeclaration(node: ESTree.VariableDeclaration) {
      offsets.setOffsetElementList(
        node.declarations,
        sourceCode.getFirstToken(node),
        null,
        1,
      )
    },
    VariableDeclarator(node: ESTree.VariableDeclarator) {
      if (node.init != null) {
        const idToken = sourceCode.getFirstToken(node)
        const eqToken = sourceCode.getTokenAfter(node.id)!
        const initToken = sourceCode.getTokenAfter(eqToken)

        offsets.setOffsetToken([eqToken, initToken], 1, idToken)
      }
    },
    WhileStatement(node: ESTree.WhileStatement | ESTree.WithStatement) {
      const firstToken = sourceCode.getFirstToken(node)
      const leftParenToken = sourceCode.getTokenAfter(firstToken)!
      const rightParenToken = sourceCode.getTokenBefore(node.body, {
        filter: isClosingParenToken,
        includeComments: false,
      })!

      offsets.setOffsetToken(leftParenToken, 1, firstToken)
      offsets.setOffsetToken(rightParenToken, 0, leftParenToken)

      const bodyFirstToken = sourceCode.getFirstToken(node.body)
      offsets.setOffsetToken(
        bodyFirstToken,
        isOpeningBraceToken(bodyFirstToken) ? 0 : 1,
        firstToken,
      )
    },
    WithStatement(node: ESTree.WithStatement) {
      visitor.WhileStatement(node)
    },
    YieldExpression(node: ESTree.YieldExpression) {
      if (node.argument != null) {
        const [yieldToken, secondToken] = sourceCode.getFirstTokens(node, {
          count: 2,
          includeComments: false,
        })

        offsets.setOffsetToken(secondToken, 1, yieldToken)
        if (node.delegate) {
          offsets.setOffsetToken(
            sourceCode.getTokenAfter(secondToken),
            1,
            yieldToken,
          )
        }
      }
    },

    // ----------------------------------------------------------------------
    // SINGLE TOKEN NODES
    // ----------------------------------------------------------------------
    DebuggerStatement() {
      // noop
    },
    Identifier() {
      // noop
    },
    ImportDefaultSpecifier() {
      // noop
    },
    Literal() {
      // noop
    },
    PrivateIdentifier() {
      // noop
    },
    Super() {
      // noop
    },
    TemplateElement() {
      // noop
    },
    ThisExpression() {
      // noop
    },
    // ----------------------------------------------------------------------
    // WRAPPER NODES
    // ----------------------------------------------------------------------
    ExpressionStatement() {
      // noop
    },
    ChainExpression() {
      // noop
    },
    EmptyStatement() {
      // noop
    },
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ignore
  const commonVisitor: any = {
    ":statement, PropertyDefinition"(node: ESTree.Statement) {
      const firstToken = sourceCode.getFirstToken(node)
      const lastToken = sourceCode.getLastToken(node)
      if (isSemicolonToken(lastToken) && firstToken !== lastToken) {
        const next = sourceCode.getTokenAfter(lastToken)
        if (!next || lastToken.loc.start.line < next.loc.start.line) {
          // End of line semicolons
          offsets.setOffsetToken(lastToken, 0, firstToken)
        }
      }
    },
    ":expression"(node: ESTree.Expression) {
      // Proc parentheses.
      let leftToken = sourceCode.getTokenBefore(node)
      let rightToken = sourceCode.getTokenAfter(node)
      let firstToken = sourceCode.getFirstToken(node)

      while (
        leftToken &&
        isOpeningParenToken(leftToken) &&
        rightToken &&
        isClosingParenToken(rightToken)
      ) {
        offsets.setOffsetToken(firstToken, 1, leftToken)
        offsets.setOffsetToken(rightToken, 0, leftToken)

        firstToken = leftToken
        leftToken = sourceCode.getTokenBefore(leftToken)
        rightToken = sourceCode.getTokenAfter(rightToken)
      }
    },
  }
  const v: NodeListener = visitor

  return {
    ...v,
    ...commonVisitor,
  }
}

/** Get the parent node from the given node */
function getParent(node: ESTree.Node): ESTree.Node | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ignore
  return (node as any).parent || null
}

/**
 * Checks whether given text is known button type
 */
function isOptionalToken(token: { type: string; value: string }): boolean {
  return token.type === "Punctuator" && token.value === "?."
}