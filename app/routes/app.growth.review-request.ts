import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  dismissReviewRequest,
  openReviewRequest,
} from "~/app/services/growth.server";

export const loader = (args: LoaderFunctionArgs) => openReviewRequest(args);
export const action = (args: ActionFunctionArgs) => dismissReviewRequest(args);
