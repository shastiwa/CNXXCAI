import { env } from "@/lib/env";
import { liveBwf, liveHelix } from "./live";
import { mockBwf, mockHelix } from "./mock";

export const helix = () => (env().HELIX_MODE === "live" ? liveHelix : mockHelix);
export const bwf = () => (env().BWF_MODE === "live" ? liveBwf : mockBwf);
