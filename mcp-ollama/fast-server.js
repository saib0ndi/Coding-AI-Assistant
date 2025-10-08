#!/usr/bin/env node

import { FastMCPServer } from './dist/server/FastMCPServer.js';

const server = new FastMCPServer();
server.start(3077);