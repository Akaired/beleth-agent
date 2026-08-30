import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Avatar uploads (`uploadAvatarAction`) accept files up to 2 MB; the raw
    // multipart body is a little larger than the file itself. The default
    // Server Action body limit is 1 MB, which rejects any real photo.
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
