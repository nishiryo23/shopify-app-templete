import type { LoaderFunctionArgs } from "react-router";

import { loadWeeklyFunnelSummary } from "~/app/services/growth.server";

export const loader = (args: LoaderFunctionArgs) => loadWeeklyFunnelSummary(args);
