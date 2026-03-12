/* eslint-disable no-unused-vars */
import { delegatedAction, delegatedLoader } from "~/app/lib/delegated-loader";

type LoaderArgs = { request: Request };
type ActionArgs = { request: Request };

export const loader: (args: LoaderArgs) => Promise<Response> = delegatedLoader;
export const action: (args: ActionArgs) => Promise<Response> = delegatedAction as (
  args: ActionArgs
) => Promise<Response>;
