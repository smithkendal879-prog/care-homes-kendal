# J-Veraxs ↔ XToys bridge

Lets XToys control a JoyHub **J-Veraxs** from an iPhone, using the Bluefy browser.

```
XToys (HTTP Post Toy)  --POST-->  Cloudflare relay  --live connection-->  Bridge page in Bluefy  --Bluetooth-->  J-Veraxs
```

* `relay/`: a free Cloudflare Worker. It receives XToys's commands and passes them straight to the bridge page. It also hosts the bridge page itself.
* `bridge/index.html`: the bridge page. It connects to the toy and has manual sliders and a big STOP button.

Everything sits behind a **secret key** in the address. Without the key, the relay answers "Not found".

**Safety.** The bridge stops the toy when any of these happen:

* you tap STOP. XToys is then ignored until you tap "Let XToys control again".
* the bridge loses its connection to the relay.
* XToys sends nothing for 10 seconds while it is driving the toy. You can change this in *Safety settings*.
* the page is closed, Bluefy goes to the background, or the screen locks.

---

## Setup, step by step

You do this once. It takes about 15 minutes. You need a free Cloudflare account.

### Step 1: Get the code onto your main branch

The code is on the branch `claude/jveraxs-xtoys-bridge-nd77n3`. Cloudflare builds from your main branch, so merge it in first:

1. Open your repository on github.com.
2. A yellow bar should say the branch had recent pushes. Tap **Compare & pull request**. If there is no bar, go to **Pull requests → New pull request** and pick the branch.
3. Tap **Create pull request**, then **Merge pull request**, then **Confirm merge**.

### Step 2: Create the relay on Cloudflare

1. Go to **dash.cloudflare.com** and sign up. The free plan is enough.
2. In the menu, open **Workers & Pages** (under *Compute*), then tap **Create**.
3. Choose **Import a repository**, then **Connect GitHub**. Allow access to your repository.
4. Pick your repository. On the settings screen:
   * **Project name:** `jveraxs-relay`. Use exactly this; it must match the code.
   * **Build command:** leave empty.
   * **Deploy command:** `npx wrangler deploy`
   * Open **Advanced settings**. Set **Root directory / Path** to `xtoys-bridge/relay`.
5. Tap **Create and deploy** and wait for the green "Success".
6. If Cloudflare asks you to pick a *workers.dev subdomain*, pick any name, for example your nickname.

### Step 3: Add your secret key

1. Make a secret key: **at least 24 characters, using only letters, numbers and dashes**. Example shape: `k7Pq-2xVm9-RtL4w-8sZb3`. Don't use this example. Your iPhone can suggest a strong password, or you can mash the keyboard.
2. Save the key in your Passwords app or Notes. Treat it like a password: anyone with the key can control the toy.
3. In Cloudflare, open the **jveraxs-relay** Worker. Go to **Settings → Variables and Secrets → Add**.
   * **Type:** Secret
   * **Variable name:** `SECRET` (capital letters)
   * **Value:** your key
4. Tap **Deploy** (or **Save**).

### Step 4: Open the bridge page in Bluefy

1. In the Worker's overview, find its address. It looks like `https://jveraxs-relay.YOURNAME.workers.dev`.
2. Add `/` + your key + `/` to the end:
   `https://jveraxs-relay.YOURNAME.workers.dev/YOUR-SECRET-KEY/`
3. Open that address in **Bluefy**, not Safari: Safari has no Bluetooth. Bookmark it.
4. After a moment, the chip at the top should say **XToys relay: connected**.
5. Turn the toy on. Tap **Connect toy** and pick **J-Veraxs** from the list.
6. Try the sliders. The toy should respond. Tap **STOP** to check that it stops.

**Quick relay test:** the page shows a "Quick test" address ending in `/cmd?vibrate=30`. Open that address in **Safari** while Bluefy stays open. You will have to switch back to Bluefy quickly, because the bridge stops the toy when Bluefy is in the background.
The toy should vibrate at 30%, then stop by itself after 10 seconds. That proves the relay works.

### Step 5: Set up the HTTP Post Toy in XToys

1. On the bridge page, under **XToys remote control**, tap **Copy** next to the first address. It ends in `/cmd`.
2. Go to **xtoys.app** and sign in. A free account works.
3. Open the side menu → **Custom Toys** → the **+** button → choose the **HTTP Post** toy.
4. Fill it in:
   * **Name:** J-Veraxs
   * **URL / address:** paste the address you copied
   * **Format** (if asked): JSON
   * **Toy type:** **2 Channel Vibrator** if that option exists. Channel 1 is vibration and channel 2 is suction. If not, pick **Vibrator**.
   * **Number of intensity steps** (if asked): 100
   * **Max message frequency** (if asked): about 5–10 per second
5. Save. Then add the toy to your session from the Custom Toys list.
6. Move its slider in XToys. The bridge page should show the message under **Last message from XToys**, and the toy should react.

**Suction as a separate toy:** if you picked a 1-channel *Vibrator*, make a second HTTP Post Toy for suction. Use the second address the bridge page shows; it ends in `/cmd?ch=suction`.

**If it doesn't react:** look at **Last message from XToys** on the bridge page.

* It still says "(nothing yet)": the URL in XToys is wrong. Copy it again.
* It shows a message but the toy doesn't move: the bridge didn't understand XToys's format. Send me that text and I'll adjust it. If the toy moves too weakly or too strongly, try changing **XToys number range** in Safety settings.

---

## Good to know

* **Keep Bluefy open with the screen on.** iOS pauses background web pages, so the bridge stops the toy when you leave Bluefy or lock the screen. The page tries to keep the screen awake. Also set **Settings → Display & Brightness → Auto-Lock** to a long time while playing.
* **The 10-second safety timer.** XToys may only send a message when a value *changes*. If you hold one steady level for more than 10 seconds, the toy stops: that's the safety timer working. Use a pattern in XToys, or raise the timer in **Safety settings**.
* **The toy's own power button is the final stop.** If your phone's battery dies or Bluetooth drops, the toy may keep running at its last level, because nothing can reach it.
* **To change your key,** change the `SECRET` value in Cloudflare (Step 3) and update your bookmark.
* **Cost.** Cloudflare's free plan allows 100,000 requests a day, which is far more than a session uses.

## Optional: hosting the bridge page on GitHub Pages

You don't need this, because the relay already hosts the page. Free GitHub Pages only works on **public** repositories, and making this repository public would expose all of its other code.
If you still want it: create a new **public** repository, upload `bridge/index.html` as `index.html`, and enable **Settings → Pages** (branch `main`, folder `/`). Open the Pages address in Bluefy. Paste `https://jveraxs-relay.YOURNAME.workers.dev/YOUR-SECRET-KEY` into **Relay address**, then tap **Connect to XToys relay**. The page remembers the address on that phone.

## For developers

```
cd xtoys-bridge/relay
npm install
echo "SECRET=some-long-test-secret" > .dev.vars
npx wrangler dev        # bridge page at http://localhost:8787/some-long-test-secret/
```

The relay accepts commands as a POST body (JSON, form data or plain text) or as query parameters, and passes them through unchanged. The bridge reads:

* the vibration value from `vibrate`, `vibration`, `intensity`, `value`, `speed`, …
* the suction value from `suction`, `suck`, `vibrate2`, …
* `channel: 2`, or `?ch=suction`, to send a single value to suction instead.

Values from 0 to 100 are assumed by default.
