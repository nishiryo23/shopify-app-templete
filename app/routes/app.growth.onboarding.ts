import type { ActionFunctionArgs } from "react-router";

import { completeOnboardingStepAction } from "~/app/services/growth.server";

export const action = (args: ActionFunctionArgs) => completeOnboardingStepAction(args);
