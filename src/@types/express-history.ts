declare module "express-history-api-fallback" {
    type HistoryOptions = {
        root: string
    }
    const lib: (
        fallbackDocument: string, 
        options: HistoryOptions
    ) => any;
    export default lib
}