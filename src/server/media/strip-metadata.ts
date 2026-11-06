import "server-only"
import { NotImplemented } from "../http/errors"

/** Drops JPEG APP1/APP13, PNG eXIf/tEXt/iTXt/zTXt and WebP EXIF/XMP (§5.4 step 5). Video is left as is. */
export async function stripMetadata(path: string, mime: string): Promise<void> {
  void path
  void mime
  throw new NotImplemented("media.stripMetadata")
}
