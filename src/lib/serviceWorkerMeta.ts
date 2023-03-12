export const serviceWorkerCacheHitHeader = {
    key: "X-Cache-Hit",
    value: "SW HIT"
} as const

export const serviceWorkerErrorCatchHeader = "Sw-Net-Err"

export const serviceWorkerPolicyHeader = "Sw-Policy"

export const NETWORK_FIRST_POLICY = 1
export const NETWORK_ONLY_POLICY = 2
export const CACHE_FIRST_POLICY = 3
export const CACHE_ONLY_POLICY = 4

export type ServiceWorkerPolicy = (
    typeof NETWORK_FIRST_POLICY
    | typeof NETWORK_ONLY_POLICY
    | typeof CACHE_FIRST_POLICY
    | typeof CACHE_ONLY_POLICY
)

export const serviceWorkerPolicies = {
    networkOnly: {"Sw-Policy": NETWORK_ONLY_POLICY.toString()},
    networkFirst: {"Sw-Policy": NETWORK_FIRST_POLICY.toString()},
    cacheFirst: {"Sw-Policy": CACHE_FIRST_POLICY.toString()},
    cacheOnly: {"Sw-Policy": CACHE_ONLY_POLICY.toString()},
} as const

export const cacheHit = (response: Response) => {
    response.headers.append(
        serviceWorkerCacheHitHeader.key, 
        serviceWorkerCacheHitHeader.value
    )
    return response
}

export const NOT_FOUND_RESPONSE = new Response("not found", {
    status: 404, 
    statusText: "NOT FOUND"
})

export const errorResponse = (err: unknown) => new Response(
    String(err), {
    status: 500,
    statusText: "INTERNAL SERVER ERROR",
    headers: {[serviceWorkerErrorCatchHeader]: "1"}
})

export type LogFn = (...msgs: any[]) => void

export const logRequest = (
    tag: string,
    request: Request,
    logFn: LogFn,
    shouldLog: boolean,
    cached: Response | null
) => {
    if (shouldLog) {
        logFn(`incoming request (${tag}): url=${request.url}, cache_hit=${!!cached}, cache_status=${cached?.status || "none"}, mode=${request.mode}, destination=${request.destination}`)
    }
}
