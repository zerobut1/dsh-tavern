#!/usr/bin/env node
import { NETWORK_FILE } from './launcher-environment.mjs'
import { configureServiceNetwork } from './service-network.mjs'

try { configureServiceNetwork(process.argv.slice(2), { file: NETWORK_FILE }) }
catch (error) { console.error(error.message); process.exitCode = 1 }
