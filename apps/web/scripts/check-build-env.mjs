/**
 * Refuse un `next build` lancé en NODE_ENV=development.
 *
 * Dans ce mode, Next prérend les pages d'erreur avec le runtime Pages et
 * échoue sur « <Html> should not be imported outside of pages/_document ».
 * Le message ne dit rien de la vraie cause et envoie chercher un bug dans
 * le code applicatif, où il n'y en a pas. Le cas arrive dès qu'on charge
 * `.env.local` dans son shell avant de builder.
 */
const env = process.env.NODE_ENV;
if (env !== undefined && env !== 'production' && env !== 'test') {
  console.error(
    `\n  NODE_ENV=${env} : \`next build\` doit tourner en production.\n` +
      "  Ton shell l'a probablement hérité de .env.local.\n\n" +
      '  Relance avec :  env -u NODE_ENV pnpm --filter @mynto/web build\n',
  );
  process.exit(1);
}
