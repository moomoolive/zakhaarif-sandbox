import {expect, it, describe} from "vitest"
import {fetchCore} from "./fetchCore"
import {
    serviceWorkerCacheHitHeader as cacheHitHeader,
    serviceWorkerErrorCatchHeader as ErrorHeader,
    serviceWorkerPolicies as policies
} from "./serviceWorkerMeta"

const requestInfoToUrl = (request: RequestInfo | URL) => {
    if (typeof request === "string") {
        return request
    } else if (request instanceof Request) {
        return request.url
    } else if (request instanceof URL) {
        return request.href
    } else {
        return request as string
    }
}

type DocumentHandlers = Record<string, () => Response>

class MockCache {
    readonly cache = {} as Record<string, () => Response>
    readonly accessLog = [] as Array<{url: string, time: number}>

    constructor(initCache?: DocumentHandlers) {
        this.cache = initCache || {}
        this.accessLog = []
    }

    async getFile(url: string) {
        this.accessLog.push({url, time: Date.now()})
        const entry = this.cache[url]
        if (!entry) {
            return
        }
        return entry()
    }
}

const createFileCache = ({
    clientFileHandlers = {},
    networkFileHandlers = {}
}: {
    clientFileHandlers?: DocumentHandlers,
    networkFileHandlers?: DocumentHandlers,
}) => {
    const clientCache = new MockCache(clientFileHandlers)
    const networkCache = new MockCache(networkFileHandlers)
    const fileCache = {
        async getFile(url: string, _clientId: string) {
            return (await clientCache.getFile(url)) || null
        }
    }
    const networkFetch: typeof fetch = async (input) => {
        const url = requestInfoToUrl(input)
        const file = await networkCache.getFile(url)
        if (file) {
            return file
        }
        return new Response("", {status: 404})
    }
    return [{fileCache, networkFetch}, {
        clientCache,
        networkCache
    }] as const
}

const fetchEvent = (url: string, headers: Record<string, string> = {}) => {
    const output = {
        response: null as null | PromiseLike<Response> | Response
    }
    return {
        output,
        event: {
            res: null,
            request: new Request(url, {headers}),
            clientId: "",
            resultingClientId: "",
        } as const
    } as const
}

describe("fetch event behaviour with all other origins", () => {
    it("network only requests should only go through network", async () => {
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => new Response("", {status: 200})
            },
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("network only requests should only go through network even if network response is not ok", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => new Response("", {status: 403})
            },
        })
        const {networkCache, clientCache} = caches

        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(403)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("network only requests should return 500 if network error occurs, and not search any caches", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 403})
                }
            },
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("network first should request from network first and return if response recieved", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("network first should request from network first and return if response recieved, even if returned code is not ok", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 403})
                }
            },
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(403)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("network first should request from network first and if network error occurs, return client cached file", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 403})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("network first should request from network first and if network error occurs, return client cached file", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 403})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("network first should request from network first and if network error occurs, then request from client cache, and if resource is not found return 500", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 403})
                }
            },
            clientFileHandlers: {
                //[requestUrl]: () => {
                //    return new Response("", {status: 200})
                //}
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("network first should request from network first and if network error occurs, then request from client cache, and if resource is cached but has error http code return 500", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 403})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 403})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-only requests should return file from client cache", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-only requests should request file from client cache first, and if not found return 404", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                //[requestUrl]: () => {
                //    return new Response("", {status: 200})
                //}
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(404)
        expect(networkCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-only requests should request file from client cache first, and if found with error http code, return response", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 401})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(401)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-first requests should request file from client cache first, and if found return response", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-first requests should request file from client cache first, and if found but response has error http code, return network response", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 401})
                }
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-first requests should request file from client cache first, and if not found, return network response", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                //[requestUrl]: () => {
                //    return new Response("", {status: 401})
                //}
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(200)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-first requests should request file from client cache first, and if not found, return network response, even if response is not ok", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    return new Response("", {status: 403})
                }
            },
            clientFileHandlers: {
                //[requestUrl]: () => {
                //    return new Response("", {status: 401})
                //}
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(403)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })

    it("cache-first requests should request file from client cache first, and if not found, return network response, and if network error occurs, return 500", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => {
                    throw new Error("network error")
                    return new Response("", {status: 200})
                }
            },
            clientFileHandlers: {
                //[requestUrl]: () => {
                //    return new Response("", {status: 401})
                //}
            }
        })
        const {networkCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)

        const res = await fetchCore(
            event.request,
            adaptors.networkFetch,
            adaptors.fileCache,
            event.clientId,
            console.log,
            false
        )
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })
})