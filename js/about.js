/*  Help > About Xsegon: the program's own name, version, licence and maker,
 *  whatever name and logo a copy wears (roadmap BB1, js\brand.js). The MIT
 *  licence travels as LICENSE in Xsegon's folder; this keeps the credit one
 *  press away on screen too.
 */

import { brandNow } from "./brand.js";
import { confirmWindow } from "./confirm.js";
import { L } from "./log.js";
import { HELP_MAIL, el } from "./util.js";

export function openAbout() {
  L("MNU", "about Xsegon");
  confirmWindow("About Xsegon", function (box) {
    box.classList.add("about");
    box.appendChild(el("p", "about-version", "Xsegon " + (window.XSEGON.build || "")));
    box.appendChild(el("p", null, "Shows your games like a console menu and starts them for you."));
    box.appendChild(el("p", null, "Free and open source under the MIT licence (LICENSE in Xsegon's folder). Copyright 2026 Tumultuous Productions."));
    box.appendChild(el("p", "about-where", "tumultuousproductions.site · github.com/TumultuousProductions/Xsegon · " + HELP_MAIL));
    var b = brandNow();
    if (b.own) {
      box.appendChild(el("p", "about-yours", "This copy wears " + (b.name ? "the name " + b.name : "a picture of its own") +
        ": Settings > Feel > Your name and logo changes it, and Use Xsegon's puts Xsegon's back."));
    }
  }, null, "Close");
}
