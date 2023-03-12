import {
    serviceWorkerPolicyHeader as policyHeader,
    serviceWorkerPolicies as policies,
    ServiceWorkerPolicy,
    NETWORK_FIRST_POLICY,
    NETWORK_ONLY_POLICY,
    CACHE_ONLY_POLICY,
    cacheHit,
    NOT_FOUND_RESPONSE,
    errorResponse,
    LogFn,
    logRequest
} from "./serviceWorkerMeta"

const CACHE_FIRST = policies.cacheFirst["Sw-Policy"]

const safeRequest = async (request: Promise<Response>) => {
    try {
        return await request
    } catch (err) {
        return errorResponse(err)
    }
}

const cachefirstTag = "cache-first"
const cacheonlyTag = "cache-only"
const networkfirstTag = "network-first"

export const fetchCore = async (
    request: Request,
    networkFetch: typeof fetch,
    fileCache: {
        getFile: (url: string, clientId: string) => Promise<Response | null>
    },
    targetClientId: string,
    log: LogFn,
    shouldLog: boolean
) => {
    const policyString = (
        request.headers.get(policyHeader)
        || CACHE_FIRST
    )
    const policy = parseInt(policyString, 10) as ServiceWorkerPolicy

    switch (policy) {
        case NETWORK_ONLY_POLICY: {
            logRequest(
                networkfirstTag, 
                request, 
                log, 
                shouldLog,
                null
            )
            return await safeRequest(networkFetch(request))
        }
        case NETWORK_FIRST_POLICY: {
            try {
                const res = await networkFetch(request)
                logRequest(
                    networkfirstTag, 
                    request, 
                    log, 
                    shouldLog,
                    null
                )
                return res
            } catch (err) {
                const cached = await fileCache.getFile(request.url, targetClientId)
                logRequest(
                    networkfirstTag, 
                    request, 
                    log,
                    shouldLog,
                    cached
                )
                if (cached && cached.ok) {
                    return cacheHit(cached)
                }
                return errorResponse(err)
            }
        }
        case CACHE_ONLY_POLICY: {
            const cached = await fileCache.getFile(request.url, targetClientId)
            logRequest(
                cacheonlyTag, 
                request, 
                log,
                shouldLog,
                cached
            )
            if (cached) {
                return cacheHit(cached)
            }
            return NOT_FOUND_RESPONSE
        }
        default: {
            const cached = await fileCache.getFile(request.url, targetClientId)
            logRequest(
                cachefirstTag, 
                request,
                log,
                shouldLog,
                cached
            )
            if (cached && cached.ok) {
                return cacheHit(cached)
            }
            return await safeRequest(networkFetch(request))
        }
    }
}