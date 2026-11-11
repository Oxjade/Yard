// Stand-in for tools/create-admin.mjs (rehearsal only).
import { parseArgs } from "node:util"
const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, "print-link": { type: "boolean" } } })
if (!values.email || !values.name) { console.error("--email and --name are required"); process.exit(2) }
console.log(`would create owner ${values.name} <${values.email}> on ${process.env.YARD_ENV_NAME} as uid ${process.getuid()}; set-password link: ${process.env.YARD_PUBLIC_URL}/set-password#dummy`)
