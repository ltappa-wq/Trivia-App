/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Server Actions when the app is reached through a proxied host
    // (e.g. GitHub Codespaces / port forwarding), where the forwarded host
    // differs from the origin. Safe for local dev.
    serverActions: {
      allowedOrigins: ["*.app.github.dev", "localhost:3000"],
    },
  },
};

export default nextConfig;
