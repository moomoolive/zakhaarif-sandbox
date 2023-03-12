import fs from "fs/promises"

const htmlSourcePath = "src/src/index.html"
const indexFile = htmlSourcePath
const jsSourcePath = "src/src/secure.compiled.js"
const secureJsScript = jsSourcePath

const [htmlString, jsString] = await Promise.all([
    fs.readFile(indexFile, {encoding: "utf-8"}),
    fs.readFile(secureJsScript, {encoding: "utf-8"}),
])

const inlineHtmlPath = "src/serviceWorker/index-html.inlined.json"
const htmlPath = inlineHtmlPath
const inlineJsPath = "src/serviceWorker/secure-compiled-mjs.inlined.json"
const jsPath = inlineJsPath
await Promise.all([
    fs.writeFile(htmlPath, JSON.stringify(htmlString), {encoding: "utf-8"}),
    fs.writeFile(jsPath, JSON.stringify(jsString), {encoding: "utf-8"}),
])

const byteLength = (str = "") => new TextEncoder().encode(str).length

const metadataPath = "src/serviceWorker/inlinedMeta.ts"
const inlinedMetadataPath = metadataPath

const htmlSize = byteLength(htmlString)
const jsSize = byteLength(jsString)

const sizeText = `
export const INDEX_HTML_LENGTH = ${htmlSize}
export const SECURE_MJS_LENGTH = ${jsSize}
`.trim()

await fs.writeFile(inlinedMetadataPath, sizeText, {encoding: "utf-8"})

console.info(`[SANDBOX_COMPILATION] inlined '${htmlSourcePath}' to '${inlineHtmlPath}' (${(htmlSize / 1_000).toFixed(2)}kb)`)
console.info(`[SANDBOX_COMPILATION] inlined '${jsSourcePath}' to '${inlineJsPath}' (${(jsSize / 1_000).toFixed(2)}kb)`)