import remark from 'remark'
import remarkHTML from 'remark-html'

import remarkApplicationLinksPlugin from '../src'

function parseText(text: string, blockedUrlSchemes?: string[]) {
    return remark()
        .use(remarkApplicationLinksPlugin(blockedUrlSchemes))
        .use(remarkHTML)
        .processSync(text)
        .toString()
        .trim()
}

describe('remark-application-links', () => {
    it('Parses https markdownlink', () => {
        expect(parseText('[remark](https://github.com/remarkjs/remark)')).toBe(
            '<p><a href="https://github.com/remarkjs/remark">remark</a></p>',
        )
    })

    it('Parses https link', () => {
        expect(parseText('https://github.com/remarkjs/remark')).toBe(
            '<p><a href="https://github.com/remarkjs/remark">https://github.com/remarkjs/remark</a></p>',
        )
    })

    it('Parses https link surrounded by text', () => {
        expect(parseText('Text before https://github.com/remarkjs/remark and after')).toBe(
            '<p>Text before <a href="https://github.com/remarkjs/remark">https://github.com/remarkjs/remark</a> and after</p>',
        )
    })

    it('Parses notion link', () => {
        expect(parseText('notion://notion.so/user/123')).toBe(
            '<p><a href="notion://notion.so/user/123">notion://notion.so/user/123</a></p>',
        )
    })

    it('Parses notion link surrounded by text', () => {
        expect(parseText('Text before notion://notion.so/user/123 and after')).toBe(
            '<p>Text before <a href="notion://notion.so/user/123">notion://notion.so/user/123</a> and after</p>',
        )
    })

    it('Does not parse javascript link', () => {
        // eslint-disable-next-line no-script-url
        expect(parseText('javascript:alert(1)')).toBe('<p>javascript:alert(1)</p>')
    })

    it('Does not parse javascript link with slashes', () => {
        // eslint-disable-next-line no-script-url
        expect(parseText('javascript://alert(1)')).toBe('<p>javascript://alert(1)</p>')
    })

    it('Does not parse javascript link surrounded by text', () => {
        expect(parseText('Text before javascript://alert(1) and after')).toBe(
            '<p>Text before javascript://alert(1) and after</p>',
        )
    })

    it('Parses notion link and ignores javascript link surrounded by text', () => {
        expect(
            parseText(
                'Text before notion://notion.so/user/123 and after javascript:alert(1) and after',
            ),
        ).toBe(
            '<p>Text before <a href="notion://notion.so/user/123">notion://notion.so/user/123</a> and after javascript:alert(1) and after</p>',
        )
    })

    it('Does not parse notion links if it is part of blocked url schemes', () => {
        expect(parseText('notion://notion.so/user/123', ['notion'])).toBe(
            '<p>notion://notion.so/user/123</p>',
        )
    })

    it('DANGER: allows potentially unsafe schemes in markdown links', () => {
        expect(parseText('[link](javascript:alert(1))')).toBe(
            '<p><a href="javascript:alert(1)">link</a></p>',
        )
    })
})
