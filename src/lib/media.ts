export function inferMediaType(filenameOrUrl: string): string {
  const ext = filenameOrUrl.split(".").pop()?.toLowerCase().split("?")[0];
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}
