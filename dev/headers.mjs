import fs from "fs/promises"

const HEADERS_FOR_ALL_URLS = "/*"

const file = `
${HEADERS_FOR_ALL_URLS}
    Cross-Origin-Embedder-Policy: require-corp
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Resource-Policy: cross-origin
    X-Content-Type-Options: nosniff
    Access-Control-Allow-Origin: *
`.trim()


const CLOUDFLARE_HEADER_FILE = "_headers"
console.log("creating deployment headers...")

await fs.writeFile(`dist/${CLOUDFLARE_HEADER_FILE}`, file)

console.info(`successfully created headers!`)