import { useEffect } from "react";

import { syncBackgroundFoldersOnLaunch } from "~/customBackground/folderSync";

export function BackgroundFolderSync() {
  useEffect(() => {
    void syncBackgroundFoldersOnLaunch();
  }, []);
  return null;
}
