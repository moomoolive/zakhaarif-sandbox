import {wRpc, MessagableEntity} from "w-worker-rpc"
import type {DaemonRpcs} from "zakhaarif-dev-tools"

type WindowMessageEvent = {
    source: MessagableEntity
    data: unknown
    origin: string
}

const window = self as unknown as {
    readonly top : {
        postMessage: (data: unknown, origin: string, transferables: Transferable[]) => unknown
    }
    addEventListener: (name: "message", handler: (event: WindowMessageEvent) => any) => unknown
    removeEventListener: (name: "message", handler: (event: WindowMessageEvent) => any) => unknown
}

type ControllerRpcState = {
    authToken: string
}

const sandboxResponses = {
    ping: () => 1
}

const {top, addEventListener, removeEventListener} = window

export type SandboxResponses = typeof sandboxResponses

let callback: Parameters<typeof window["addEventListener"]>[1] = () => {}

export const controllerRpc = new wRpc<DaemonRpcs, ControllerRpcState>({
    responses: sandboxResponses,
    messageTarget: {
        postMessage: (data, transferables) => {
            top.postMessage(data, "*", transferables)
        },
        addEventListener: (_, handler) => {
            callback = (event) => {
                if (event.source !== (top as object)) {
                    return
                }
                handler({data: event.data})
            }
            addEventListener("message", callback)
        },
        removeEventListener: () => {
            removeEventListener("message", callback)
        }
    },
    state: {authToken: ""}
})

export const serviceWorkerToSandboxRpc = {
    getFile: async (url: string) => {
        const file = await controllerRpc.execute("getFile", url)
        if (!file) {
            return file
        }
        return wRpc.transfer(file, [file.body])
    }
} as const

export type CallableFunctions = typeof serviceWorkerToSandboxRpc