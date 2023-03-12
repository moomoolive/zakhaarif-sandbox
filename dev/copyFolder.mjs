#!/usr/bin/env node
import fs from "fs-extra"
import commandLineArgs from "command-line-args"

(async () => {
    const {source = "", dest = ""} = commandLineArgs([
        {name: "source", type: String},
        {name: "dest", type: String}
    ])

    if (!source || !dest) {
        console.error(`source and dest option must be specified`)
        return
    }
    
    console.log("copying", source, "to", dest)
    
    await fs.copy(source, dest)
})()