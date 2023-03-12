import {wRpc} from "w-worker-rpc"
import type {ServiceWorkerFunctions} from "./serviceWorkerFunctions"
import {serviceWorkerToSandboxRpc, controllerRpc} from "./sandboxFunctions"
import type {ExtensionModule, MainScriptArguments} from "zakhaarif-dev-tools"
import {SERVICE_WORKER_FILE} from "./config"

if (window.top !== window.parent) {
    throw new Error("second-level embedding is disallowed")
}

if (window.self === window.top) {
    throw new Error("document must be embedded in iframe")
}

const main = async () => {
    if (!("serviceWorker" in navigator)) {
        await controllerRpc.execute("signalFatalError", {details: "Service worker not supported"})
        throw new Error("sandbox requires service worker to function")
    }

    const [registration] = await Promise.all([
        navigator.serviceWorker.ready,
        navigator.serviceWorker.register(SERVICE_WORKER_FILE)
    ] as const)
    const {active: sw} = registration
    const swRpc = new wRpc<ServiceWorkerFunctions>({
        responses: serviceWorkerToSandboxRpc,
        messageTarget: {
            postMessage: (data, transferables) => {
                sw?.postMessage(data, transferables)
            },
            addEventListener: (_, handler) => {
                navigator.serviceWorker.addEventListener("message", handler)
            },
            removeEventListener: (_, handler) => {
                navigator.serviceWorker.removeEventListener("message", handler)
            }
        },
        state: {}
    })
    
    const rootElement = document.createElement("div")
    rootElement.setAttribute("id", "root")
    document.body.appendChild(rootElement)
    const emptyTransfer = [] as Transferable[]
    const extensionArguments: MainScriptArguments = {
        rootElement,
        initialState: await controllerRpc.execute("getInitialState"),
        messageAppShell: (name, data = null, transferables = emptyTransfer) => {
            return (controllerRpc.execute as Function)(name, data, transferables)
        },
        addRpcResponses: (responses) => {
            return controllerRpc.addResponses(responses, {allowOverwrite: false})
        },
        logPrivateDeps: () => {
            console.info("private deps", {swRpc, controllerRpc})
        }
    }
    
    await controllerRpc.execute("secureContextEstablished")
    // all security should be done before this point
    
    const root = document.getElementById("root-script")
    const script = await (async (url: string) => {
        try {
            console.info("importing", url)
            return await import(url) as ExtensionModule
        } catch (error) {
            console.error("encountered error when importing module", error)
            return null
        }
    })(root?.getAttribute("entry") || "")
    
    if (!script) {
        controllerRpc.execute("signalFatalError", {
            details: "couldn't find extension entry"
        })
        throw new Error("extension entry does not exist")
    }
    
    if (!("main" in script)) {
        controllerRpc.execute("signalFatalError", {
            details: "'main' function is not exported from entry"
        })
        throw new Error("no main function exported from module")
    }
    script.main(extensionArguments)
}

main()
