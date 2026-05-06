/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "https://api.taskora.deftai.in/api/v1/:path*",
      },
    ];
  },
};
module.exports = nextConfig;
