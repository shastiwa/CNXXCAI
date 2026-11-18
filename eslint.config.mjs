import next from "eslint-config-next";
const config = [...next, { ignores: [".next/**", "node_modules/**", "prisma/*.db*"] }];
export default config;
