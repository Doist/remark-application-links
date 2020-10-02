/**
 * This is heavily inspired by `remark-linkify-regex`
 * https://gitlab.com/staltz/remark-linkify-regex/blob/master/index.js
 *
 * remark-linkify-regex works on an allow list to support more protocols (url
 * schemes). This plugin works with a block list to support everything that
 * remotely looks like a link but blocks potentially dangerous schemes.
 */

import visitWithParents from 'unist-util-visit-parents'
import flatMap from 'unist-util-flatmap'
import { Node } from 'unist'

/**
 * Default collection of url schemes that will be blocked by this plugin. All
 * others schemes are allowed.
 */
const BLOCKED_URL_SCHEMES = ['data', 'jar', 'java', 'javascript', 'vbscript', 'view-source']

function buildTextNode(content: string) {
    return { type: 'text', value: content }
}

function buildLinkNode(url: string, children: Node[]) {
    return {
        type: 'link',
        title: null,
        url,
        children,
    }
}

// looks for any non-whitespace character sequence that contains `://`
const REGEX_POTENTIAL_URL = /\S+:\/\/\S+/g

function splitTextNode(textNode: Node, blockedUrlSchemes: string[]) {
    const content = textNode.value as string
    const result: Node[] = []
    let textStartIndex = 0
    let match: RegExpExecArray | null | never[] = []

    while ((match = REGEX_POTENTIAL_URL.exec(content)) !== null) {
        const matchingText = match[0]
        const matchStartIndex = match.index
        const urlScheme = matchingText.split('://')[0]
        const isBlockedScheme = blockedUrlSchemes.includes(urlScheme)

        // create a new text node for everything before the match
        if (textStartIndex !== matchStartIndex) {
            result.push(buildTextNode(content.slice(textStartIndex, matchStartIndex)))
        }

        // either insert another text node if the url scheme is blocked or insert a link
        if (isBlockedScheme) {
            result.push(buildTextNode(matchingText))
        } else {
            result.push(buildLinkNode(matchingText, [buildTextNode(matchingText)]))
        }

        // move the pointer ahead so we can support multiple links
        textStartIndex = matchStartIndex + matchingText.length
    }

    // this path will also be executed when no url has been found
    const remainingText = content.slice(textStartIndex)
    if (remainingText.length > 0) {
        result.push(buildTextNode(remainingText))
    }

    return result
}

function remarkApplicationLinks(blockedUrlSchemes = BLOCKED_URL_SCHEMES) {
    return () => (ast: Node) => {
        visitWithParents(ast, 'text', (textNode, parents) => {
            if (parents.length > 0 && parents[parents.length - 1].type === 'link') {
                textNode._ignoreMe = true
                return
            }
        })

        flatMap(ast, (node: Node) => {
            if (node.type !== 'text') {
                return [node]
            }
            if (node._ignoreMe) {
                delete node._ignoreMe
                return [node]
            }
            return splitTextNode(node, blockedUrlSchemes)
        })

        return ast
    }
}

export default remarkApplicationLinks
