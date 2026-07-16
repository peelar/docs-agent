import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

import { evalSlackAuth } from "../../repositories/configuration/eval-auth";
import { operatorWebAuth } from "../../repositories/configuration/operator-auth";

export default eveChannel({
  auth: [
    evalSlackAuth(),
    operatorWebAuth(),
    vercelOidc(),
    localDev(),
    placeholderAuth(),
  ],
});
