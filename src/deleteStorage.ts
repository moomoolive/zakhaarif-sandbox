export async function deleteStorage(): Promise<boolean> {
    const cacheKeys = await caches.keys()
    const indexeddbKeys: string[] = []
    // as of writing this Firefox doesn't yet support this
    // api (althought it is a standard)
    if ("databases" in indexedDB) {
        const databases = await (async () => { 
            try {
                return await indexedDB.databases() 
            } catch { 
                return [] 
            } 
        })()
        const databaseNames = databases.map((info) => info.name || "")
        indexeddbKeys.push(...databaseNames.filter((name) => name.length > 0))
    }
    await Promise.all([
        ...cacheKeys.map((key) => caches.delete(key)),
        ...indexeddbKeys.map((key) => indexedDB.deleteDatabase(key)),
        navigator.serviceWorker.ready,
        Promise.resolve(localStorage.clear())
    ])
    return true
}