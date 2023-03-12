import {cacheHit, NOT_FOUND_RESPONSE, errorResponse, LogFn} from "./serviceWorkerMeta"
import {fetchCore} from "./fetchCore"
import IndexHtml from "../serviceWorker/index-html.inlined.json"
import SecureMjs from "../serviceWorker/secure-compiled-mjs.inlined.json"
import {INDEX_HTML_LENGTH, SECURE_MJS_LENGTH} from "../serviceWorker/inlinedMeta"
import { RUN_PROGRAM_PATHNAME } from "../config"

const generateTemplate = ({
    importSource, 
    securityPolicy
}: {importSource: string, securityPolicy: string}) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sandbox</title>
    <meta http-equiv="Content-Security-Policy" content="${securityPolicy}"/>
</head>
<body>
    <script entry="${importSource}" id="root-script" src="./secure.compiled.js" type="module" defer> </script>
</body>
</html>`.trim()
}

export type FileCache = {
    getClientFile: (url: string, clientId: string) => Promise<Response | null>
}

export type FetchHandlerEvent = {
    respondWith: (res: Promise<Response>) => any
    request: Request,
    waitUntil: (promise: Promise<any>) => any
    clientId: string
    resultingClientId: string
}

type ConfigReference = {
    log: boolean
}

type FetchHandlerOptions = {
    origin: string,
    fileCache: FileCache
    networkFetch: typeof fetch
    inMemoryDocumentHeaders?: Readonly<{[key: string]: string}>
    log: LogFn
    config: Readonly<ConfigReference>
}

export const createFetchHandler = (options: FetchHandlerOptions) => {
    const {
        origin, 
        fileCache, 
        networkFetch, 
        inMemoryDocumentHeaders = {},
        log,
        config,
    } = options
    const rootDoc = `${origin}/`
    const templateEndpoint = `${origin}${RUN_PROGRAM_PATHNAME}`
    const entryScript = `${origin}/secure.compiled.js`
    const testScript = `${origin}/test.mjs`
    const clientCache = {getFile: fileCache.getClientFile} as const
    return async (event: FetchHandlerEvent) => {
        const {request} = event
        if (request.url.startsWith(origin)) {
            if (request.url === rootDoc) {
                try {
                    return await networkFetch(request)
                } catch (err) {
                    const inMemoryHtml = new Response(IndexHtml, {
                        status: 200,
                        statusText: "OK",
                        headers: {
                            "content-type": "text/html",
                            "content-length": INDEX_HTML_LENGTH.toString(),
                            ...inMemoryDocumentHeaders
                        }
                    })
                    return cacheHit(inMemoryHtml)
                }
            }
    
            if (request.url.startsWith(templateEndpoint)) {
                const query = request.url.split("?")
                if (query.length < 2) {
                    return errorResponse("template endpoint must have query")
                }
                const params = new URLSearchParams("?" + query[1])
                if (!params.has("csp") || !params.has("entry")) {
                    return errorResponse("template endpoint have both an 'csp' and 'entry' query")
                }
                const securityPolicy = decodeURIComponent(params.get("csp") || "")
                const importSource = decodeURIComponent(params.get("entry") || "")
                const templateText = generateTemplate({securityPolicy, importSource})
                return new Response(templateText, {
                    status: 200,
                    statusText: "OK",
                    headers: {
                        "content-type": "text/html",
                        "content-length": new TextEncoder().encode(templateText).length.toString(),
                        ...inMemoryDocumentHeaders,
                    }
                })
            }
    
            if (request.url.startsWith(entryScript)) {
                try {
                    return await networkFetch(entryScript)
                } catch {
                    const inMemorySecureMjs = new Response(SecureMjs, {
                        status: 200,
                        statusText: "OK",
                        headers: {
                            "content-type": "text/javascript",
                            "content-length": SECURE_MJS_LENGTH.toString(),
                            ...inMemoryDocumentHeaders
                        }
                    })
                    return cacheHit(inMemorySecureMjs)
                }
            }

            if (request.url.startsWith(testScript)) {
                return networkFetch(request)
            }
            return NOT_FOUND_RESPONSE
        }

        return fetchCore(
            request,
            networkFetch,
            clientCache,
            event.clientId || event.resultingClientId,
            log,
            config.log,
        )
    }
}
