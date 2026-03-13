/* eslint-disable no-unused-vars */
type AdminGraphqlClient = {
  graphql(...args: [string]): Promise<Response>;
};

type CurrentAppInstallationResponse = {
  currentAppInstallation: {
    activeSubscriptions: Array<{
      createdAt?: string | null;
      currentPeriodEnd?: string | null;
      id?: string | null;
      name?: string | null;
      status?: string | null;
      test?: boolean | null;
    } | null> | null;
    allSubscriptions: {
      nodes: Array<{
        createdAt?: string | null;
        currentPeriodEnd?: string | null;
        id?: string | null;
        name?: string | null;
        status?: string | null;
        test?: boolean | null;
      } | null> | null;
    } | null;
  } | null;
};

export const CURRENT_APP_INSTALLATION_BILLING_QUERY = `#graphql
  query CurrentAppInstallationBilling {
    currentAppInstallation {
      activeSubscriptions {
        createdAt
        id
        name
        status
        test
        currentPeriodEnd
      }
      allSubscriptions(first: 1, reverse: true) {
        nodes {
          createdAt
          id
          name
          status
          test
          currentPeriodEnd
        }
      }
    }
  }
`;

async function parseAdminGraphqlResponse<T>(response: Response) {
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok) {
    throw new Error(`Billing query failed with HTTP ${response.status}`);
  }

  if (payload.errors?.length) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`Billing query failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error("Billing query returned no data");
  }

  return payload.data;
}

export async function queryCurrentAppInstallation(admin: AdminGraphqlClient) {
  const response = await admin.graphql(CURRENT_APP_INSTALLATION_BILLING_QUERY);

  return parseAdminGraphqlResponse<CurrentAppInstallationResponse>(response);
}
/* eslint-enable no-unused-vars */
