/** Set NEXT_PUBLIC_BASE_PATH=/repo-name when hosting under a sub-path (e.g. GitHub project pages). */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // fully static: deploy the `out/` folder to any static host
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  trailingSlash: true,
  optimizeFonts: false, // fonts load from the <link> in layout.tsx
  basePath,
};
export default nextConfig;
