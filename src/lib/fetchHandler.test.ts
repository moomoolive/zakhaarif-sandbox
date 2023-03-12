import {expect, it, describe} from "vitest"
import {createFetchHandler, FileCache, FetchHandlerEvent} from "./fetchHandler"
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
    localFileHandlers = {},
    clientFileHandlers = {},
    networkFileHandlers = {}
}: {
    localFileHandlers?: DocumentHandlers,
    clientFileHandlers?: DocumentHandlers,
    networkFileHandlers?: DocumentHandlers,
}) => {
    const localCache = new MockCache(localFileHandlers)
    const clientCache = new MockCache(clientFileHandlers)
    const networkCache = new MockCache(networkFileHandlers)
    const fileCache: FileCache = {
        async getClientFile(url, _) {
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
    return [{
        fileCache, 
        networkFetch, 
        config: {log: false}, 
        log: () => {}
    }, {
        localCache,
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
            respondWith: (res) => { output.response = res },
            request: new Request(url, {headers}),
            waitUntil: () => {},
            clientId: "",
            resultingClientId: "",
        } as FetchHandlerEvent
    } as const
}

describe("fetch handler root document behaviour", () => {
    it("root document should always be network first", async () => {
        const origin = "https://donuts.com"
        const rootText = "root"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => new Response(rootText, {
                    status: 200
                })
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe(rootText)
        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("root document should return network response even if response includes error http code", async () => {
        const origin = "https://donuts.com"
        const rootText = "error text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => new Response(rootText, {
                    status: 403
                })
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(403)
        expect(await res.text()).toBe(rootText)
        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("should return in-memory copy of root document if network error occurs, even if there is a copy in cache", async () => {
        const origin = "https://donuts.com"
        const rootText = "error text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    throw new Error("network error")
                    return new Response(rootText, {
                        status: 403
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/`]: () => new Response(cacheText, {status: 200})
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(res.headers.get("content-type")).toBe("text/html")
        expect(await res.text()).not.toBe(cacheText)
        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(true)
        expect(
            localCache.accessLog.some((log) => log.url === `${origin}/offline.html`)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })
})

describe("fetch handler behaviour with template endpoint (/runProgram)", () => {
    it("should return 500 if request url does not have query parameter", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => new Response(cacheText, {status: 403})
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/runProgram`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })

    it("should return 500 if request url does not have 'csp' or 'entry' parameters", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => new Response(cacheText, {status: 403})
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/runProgram`
        expect(
            (await handler(fetchEvent(`${origin}/runProgram?`).event)).status
        ).toBe(500)
        expect(
            (await handler(fetchEvent(`${origin}/runProgram?csp=true`).event)).status
        ).toBe(500)
        expect(
            (await handler(fetchEvent(`${origin}/runProgram?entry=true`).event)).status
        ).toBe(500)
        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })

    it("should return 200 if request url has 'csp' and 'entry' parameters", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {
                        status: 200,
                        headers: {
                            coolheader: "1",
                            trueheader: "2"
                        }
                    })
                }
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/runProgram?csp=true&entry=index.js`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)

        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === `${origin}/offline.html`)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })

    it("should return html document with content-security-policy in the csp param and a javascript import statement for entry param", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                }
            }
        })
        const csp = `default-src 'self'; script-src 'unsafe-inline'; child-src 'none'; worker-src 'self';`
        const entry = `https://pizza.com/index.js`
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const requestUrl = `${origin}/runProgram?csp=${encodeURIComponent(csp)}&entry=${encodeURIComponent(entry)}`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)

        const htmlDoc = await res.text()
        expect(
            htmlDoc.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}"/>`)
        ).toBe(true)
        expect(
            htmlDoc.includes(`<script entry="${entry}" id="root-script"`)
        ).toBe(true)

        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === `${origin}/offline.html`)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })

    it("should return html document with inputted template headers (if applicable)", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                }
            }
        })
        const csp = `default-src 'self'; script-src 'unsafe-inline'; child-src 'none'; worker-src 'self';`
        const entry = `https://pizza.com/index.js`
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({
            origin, ...adaptors,
            inMemoryDocumentHeaders: {
                "cool-header": "3"
            }
        })
        const requestUrl = `${origin}/runProgram?csp=${encodeURIComponent(csp)}&entry=${encodeURIComponent(entry)}`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)
        expect(res.headers.get("cool-header")).toBe("3")

        const htmlDoc = await res.text()
        expect(
            htmlDoc.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}"/>`)
        ).toBe(true)
        expect(
            htmlDoc.includes(`<script entry="${entry}" id="root-script"`)
        ).toBe(true)

        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === `${origin}/offline.html`)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })

    it("should return html document with inputted with 'content-length' and 'content-type' headers, even if not specified", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                }
            }
        })
        const csp = `default-src 'self'; script-src 'unsafe-inline'; child-src 'none'; worker-src 'self';`
        const entry = `https://pizza.com/index.js`
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({
            origin, ...adaptors,
        })
        const requestUrl = `${origin}/runProgram?csp=${encodeURIComponent(csp)}&entry=${encodeURIComponent(entry)}`
        const res = await handler(fetchEvent(requestUrl).event)
        expect(res.status).toBe(200)
        expect(res.headers.has("content-length")).toBe(true)
        expect(res.headers.has("content-type")).toBe(true)

        const htmlDoc = await res.text()
        expect(
            htmlDoc.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}"/>`)
        ).toBe(true)
        expect(
            htmlDoc.includes(`<script entry="${entry}" id="root-script"`)
        ).toBe(true)

        expect(
            networkCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
        expect(
            localCache.accessLog.some((log) => log.url === `${origin}/offline.html`)
        ).toBe(false)
        expect(
            clientCache.accessLog.some((log) => log.url === requestUrl)
        ).toBe(false)
    })
})

describe("fetch handler behaviour with other resources on origin", () => {
    it("should 404 if attempt to access any resource other than secure.mjs or test.mjs on same origin", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response("console.log(0)", {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        expect((await handler(fetchEvent(`${origin}/random.mjs`).event)).status).toBe(404)
        expect((await handler(fetchEvent(`${origin}/cool/path`).event)).status).toBe(404)
        expect((await handler(fetchEvent(`${origin}/cool/resource.html`).event)).status).toBe(404)
        expect(networkCache.accessLog.length).toBe(0)
        expect(localCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("should not return 404 if test.mjs is requested", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
                [`${origin}/test.mjs`]: () => {
                    return new Response("", {status: 200})
                }
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response("console.log(0)", {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(fetchEvent(`${origin}/test.mjs`).event)
        expect(res.status).toBe(200)
        expect(networkCache.accessLog.length).toBeGreaterThan(0)
    })

    it("should return network document if same origin request is to 'secure.mjs'", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const secureText = "console.log(0)"
        const networkText = "console.log(1)"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response(networkText, {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response(secureText, {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const secureScript = `${origin}/secure.compiled.js`
        const res = await handler(fetchEvent(secureScript).event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(null)
        expect(await res.text()).toBe(networkText)
        expect(networkCache.accessLog.some((log) => log.url === secureScript)).toBe(true)
        expect(localCache.accessLog.some((log) => log.url === secureScript)).toBe(false)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("should return in memory copy if network request to secure.mjs fails, even if it is in cache", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const secureText = "console.log(0)"
        const networkText = "console.log(1)"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
                [`${origin}/secure.compiled.js`]: () => {
                    throw new Error("network error")
                    return new Response(networkText, {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response(secureText, {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            },
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const secureScript = `${origin}/secure.compiled.js`
        const res = await handler(fetchEvent(secureScript).event)
        expect(res.status).toBe(200)
        expect(res.headers.get("content-type")).toBe("text/javascript")
        expect(await res.text()).not.toBe(secureText)
        expect(networkCache.accessLog.some((log) => log.url === secureScript)).toBe(true)
        expect(localCache.accessLog.some((log) => log.url === secureScript)).toBe(false)
        expect(clientCache.accessLog.length).toBe(0)
    })

    it("should return secure.mjs document if request has query", async () => {
        const origin = "https://donuts.com"
        const rootText = "root text"
        const cacheText = "cache text"
        const secureText = "console.log(0)"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [`${origin}/`]: () => {
                    return new Response(rootText, {
                        status: 200
                    })
                },
                [`${origin}/secure.compiled.js`]: () => {
                    return new Response(secureText, {
                        status: 200,
                        headers: {
                            "content-type": "text/javascript"
                        }
                    })
                }
            },
            localFileHandlers: {
                [`${origin}/offline.html`]: () => {
                    return new Response(cacheText, {status: 200})
                }
            }
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const secureScript = `${origin}/secure.compiled.js`
        const withQuery = secureScript + "?q=true"
        const res = await handler(fetchEvent(withQuery).event)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe(secureText)
        expect(networkCache.accessLog.some((log) => log.url === secureScript)).toBe(true)
        expect(localCache.accessLog.some((log) => log.url === secureScript)).toBe(false)
        expect(clientCache.accessLog.length).toBe(0)
    })
})

describe("fetch event behaviour with all other origins", () => {
    it("network only requests should only go through network", async () => {
        const origin = "https://donuts.com"
        const requestUrl = "https://cookies.com/index,js"
        const [adaptors, caches] = createFileCache({
            networkFileHandlers: {
                [requestUrl]: () => new Response("", {status: 200})
            },
        })
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const handler = createFetchHandler({origin, ...adaptors})
        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const res = await handler(event)
        expect(res.status).toBe(403)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkOnly)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(403)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.networkFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(404)
        expect(networkCache.accessLog.length).toBe(0)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheOnly)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(401)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.get(cacheHitHeader.key)).toBe(cacheHitHeader.value)
        expect(networkCache.accessLog.length).toBe(0)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(200)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(403)
        expect(res.headers.has(cacheHitHeader.key)).toBe(false)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
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
        const {networkCache, localCache, clientCache} = caches
        const {event} = fetchEvent(requestUrl, policies.cacheFirst)
        const handler = createFetchHandler({origin, ...adaptors})
        const res = await handler(event)
        expect(res.status).toBe(500)
        expect(res.headers.has(ErrorHeader)).toBe(true)
        expect(networkCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
        expect(localCache.accessLog.length).toBe(0)
        expect(clientCache.accessLog.some((log) => log.url === requestUrl)).toBe(true)
    })
})