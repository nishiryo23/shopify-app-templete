import type { LoaderFunctionArgs } from "react-router";

import { redirectAppHome } from "~/app/services/app-shell.server";

export const loader = async (args: LoaderFunctionArgs) =>
  redirectAppHome(args);
