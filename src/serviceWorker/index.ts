import {wRpc} from "w-worker-rpc"
import {createFetchHandler} from "../lib/fetchHandler"
import type {CallableFunctions as SandboxFunctions} from "../sandboxFunctions"

const sw = globalThis.self as unknown as ServiceWorkerGlobalScope

sw.oninstall = (event) => event.waitUntil(sw.skipWaiting())

sw.onactivate = (event) => event.waitUntil((async () => {
    await sw.clients.claim()
    console.info("[📥 install] new sandbox service-worker installed")
    console.info("[🔥 activate] new sandbox sevice worker in control")
})())

const sandboxToServiceWorkerRpc = {} as const

export type CallableFunctions = typeof sandboxToServiceWorkerRpc

let handlerRef: Parameters<typeof sw.addEventListener<"message">>[1] = () => {}

const rpc = new wRpc<SandboxFunctions>({
    responses: sandboxToServiceWorkerRpc,
    messageTarget: {
        postMessage: () => {},
        addEventListener: (_, handler) => {
            handlerRef = (event) => event.waitUntil(handler(event) as Promise<unknown>)
            sw.addEventListener("message", handlerRef)
        },
        removeEventListener() {
            sw.removeEventListener("message", handlerRef)
        }
    },
    state: {}
})

const config = {log: false}

const DEV_MODE = sw.location.origin.startsWith("http://locahost")

const accessHeaders = DEV_MODE 
    ? {"Access-Control-Allow-Origin": "http://localhost:5173"} as const
    : {"Access-Control-Allow-Origin": "*"} as const

const fetchHandler = createFetchHandler({
    networkFetch: fetch,
    origin: sw.location.origin,
    fileCache: {
        getClientFile: async (url, clientId) => {
            const client = await sw.clients.get(clientId)
            if (!client) {
                return null
            }
            const file = await rpc.executeWithSource("getFile", client, url)
            if (typeof file !== "object" || file === null) {
                return null
            }
            if (
                !(file.body instanceof ReadableStream)
                || typeof file.type !== "string"
                || typeof file.length !== "number"
            ) {
                return null
            }
            return new Response(file.body, {
                status: 200,
                statusText: "OK",
                headers: {
                    "content-type": file.type,
                    "content-length": file.length
                }
            })
        },
    },
    inMemoryDocumentHeaders: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Vary": "origin",
        ...accessHeaders,
    },
    log: console.info,
    config,
})

sw.onfetch = (event) => event.respondWith(fetchHandler(event))
