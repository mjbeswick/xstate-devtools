import { ViteNodeServer } from "vite-node/server";
import { ViteNodeRunner } from "vite-node/client";
import type * as Vite from "vite";
export type Context = {
    devServer: Vite.ViteDevServer;
    server: ViteNodeServer;
    runner: ViteNodeRunner;
};
export declare function createContext({ root, mode, }: {
    root: Vite.UserConfig["root"];
    mode: Vite.ConfigEnv["mode"];
}): Promise<Context>;
