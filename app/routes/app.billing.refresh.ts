import type { LoaderFunctionArgs } from "react-router";

import { loadBillingRefresh } from "~/app/services/billing.server";

export const loader = (args: LoaderFunctionArgs) => loadBillingRefresh(args);
