/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.11.27"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin"
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
