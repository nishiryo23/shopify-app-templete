import { delegatedAction, delegatedLoader } from "~/app/lib/delegated-loader";

type LoaderFunction = typeof delegatedLoader;
type ActionFunction = typeof delegatedAction;

export const loader: LoaderFunction = delegatedLoader	as LoaderFunction;
export const action: ActionFunction = delegatedAction	satisfies ActionFunction;
