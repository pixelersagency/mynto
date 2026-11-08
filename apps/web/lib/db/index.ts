import 'server-only';

/**
 * Single DB entry point of the web app. Server-only: importing it from a
 * Client Component fails the build, so neither the driver nor
 * DATABASE_URL can end up in a browser bundle.
 */
export { db, pgErrorCode, DbSchemaError } from '@mynto/db';
export {
  getMediaStorage,
  heroKey,
  isUuid,
  newBrandFaviconKey,
  newBrandLogoKey,
} from '@mynto/db/media';
