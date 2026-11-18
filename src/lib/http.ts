import { HttpError } from "./auth";

/** Parses a JSON body; a missing or non-JSON body is a client error (400), not a server error. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}
