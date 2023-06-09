import {RUN_PROGRAM_PATHNAME, SERVICE_WORKER_FILE} from "./config"
import {deleteStorage} from "./deleteStorage"

const main = async () => {
    if (window.top === window.self) {
        console.warn("sandbox is not loaded in iframe! Place this in a sandboxed iframe for better security!")
    }
    if (!navigator.serviceWorker) {
        throw new Error("current browser doesn't support service workers")
    }
    console.info("[SANDBOX]: registering service worker...")
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_FILE)
    if (!registration.active) {
        console.warn(`service worker controller not found`)
    }
    window.setTimeout(() => {
        console.info("[SANDBOX]: service worker registered successfully") 
        if (window.location.pathname === RUN_PROGRAM_PATHNAME) {
            console.warn("application attempted to run program without registering service worker")
            window.location.reload()
        } else {
            top?.postMessage("finished", "*")
        }
    }, 2_000)
    await deleteStorage()
}
main()