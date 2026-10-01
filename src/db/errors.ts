/**
 * Database error classification for HTTP status mapping.
 *
 * Maps PostgreSQL error codes and connection failures to appropriate HTTP responses:
 * - 503 db_unavailable: Database is unreachable or auth failed
 * - 500 internal_error: Other database errors
 */

interface DbErrorClassification {
  httpStatus: 503 | 500;
  errorCode: string;
  clientMessage: string;
  /** Short reason for server logs only (no secrets) */
  logReason: string;
}

/**
 * PostgreSQL error codes that indicate the database is unavailable or
 * credentials are wrong (not application logic errors).
 */
const DB_UNAVAILABLE_CODES = new Set([
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name (database does not exist)
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
]);

/**
 * Classifies a database error for HTTP response.
 * Never returns secrets or connection strings in the client message.
 */
export function classifyDbError(err: unknown): DbErrorClassification {
  const error = err as Error & { code?: string };

  // Node.js connection errors (before reaching PostgreSQL)
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return {
      httpStatus: 503,
      errorCode: 'db_unavailable',
      clientMessage: 'The server is running but cannot reach its database.',
      logReason: `network: ${error.code}`,
    };
  }

  // PostgreSQL connection/auth failures
  if (error.code && DB_UNAVAILABLE_CODES.has(error.code)) {
    return {
      httpStatus: 503,
      errorCode: 'db_unavailable',
      clientMessage: 'The server is running but cannot reach its database.',
      logReason: `pg: ${error.code}`,
    };
  }

  // Everything else: application-level database error
  return {
    httpStatus: 500,
    errorCode: 'internal_error',
    clientMessage: 'The server hit an error. Please try again.',
    logReason: error.code ? `pg: ${error.code}` : 'unknown',
  };
}

/**
 * Generates a short request ID for correlating logs.
 * Format: timestamp in base36 + 4 random chars.
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${timestamp}-${random}`;
}
