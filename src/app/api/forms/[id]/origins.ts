/** Where the hosted LevelUp forms are served (the browser calls these routes from there). */
export const FORM_ORIGINS = [
  'https://dashboard.levelup-ecosystem.com',
  ...(process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:3123'])
];
