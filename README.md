# vazhaihtml
## for images:
### 1. Cloudinary (The Best "Free" Powerhouse)
### 2. Cloudflare R2 (The "Unlimited BandGitHub "raw" URLs are slow because GitHub's content servers (raw.githubusercontent.com) are not optimized for high-speed image delivery; they lack the aggressive global caching and on-the-fly compression that a real Image CDN provides.

## Vazhai website based on html
## improvements to be made:
### problem
overall from people psychology angle when someone visits this website, they should understand the importance of vazhai's work, think they should also contribute(volunteering, donation or spread the word, etc.,) in some way. do you think this website does it. can you suggest some improvements if not. dont change yet.
### Claude responded: 
Good question — let me think through this honestly from a visitor psychology perspective.
What the site does well
The visual identity is warm and credible. The "Then → Now" transition block clearly signals that Vazhai is evolving, not stagnant. The role cards give a concrete sense of how the organisation actually works. The donation page with real salary figures (₹15–20k, ₹25–35k) builds trust — it shows transparency about where money goes.
Where it falls short psychologically
1. No emotional hook at the entry point
   The Home page opens with "About Vazhai NGO" — an organisational description. But visitors don't yet care about the organisation. They care about people. The most powerful NGO websites lead with a child's story, a specific struggle, a before-and-after moment. Right now there's no single human face or story that makes the problem feel real. Stats (500+ students) appear before anyone has emotionally invested.
2. The problem isn't made vivid enough
   Phrases like "children face challenges related to learning exposure" are abstract. What does a school day actually look like for a child in an Aiyur forest village? No electricity? Walking 5km? A single teacher for all grades? If a visitor doesn't viscerally understand the difficulty, they won't feel urgency to act.
3. No social proof from beneficiaries or volunteers
   There's not a single quote, testimonial, or personal story from a student who was impacted, a volunteer who felt the difference, or a School Companion describing their day. These are the most persuasive elements in cause-based communication — completely absent.
4. The call to action is scattered and passive
   Every page ends differently. Some have a CTA button, some don't. There's no single moment where the visitor is guided to a clear next step. Good cause websites funnel visitors toward one action per visit — "sponsor a school companion for a month" or "join our next volunteer call on X date" — something specific and time-bound.
5. Impact feels historical, not live
   "500+ students reached" sounds like a legacy stat. There's nothing that signals right now — no mention of how many children are currently enrolled, which schools are active this month, or what's happening on the ground today. Live impact makes people feel they're joining something in motion, not reading an archive.
6. Volunteering feels vague
   "Contribute skills, create materials, guide students" — a busy professional reading this doesn't know what their first week would look like. The most effective volunteer recruitment is hyper-specific: "We need someone to review our level identification worksheet this weekend — takes 2 hours." The lower the perceived barrier, the higher the conversion.
7. No "spread the word" pathway
   If someone is moved but not ready to donate or volunteer, there's no easy off-ramp — no share button, no WhatsApp forward, no "tell a friend." Word of mouth is how most small NGOs grow, and it's completely absent.
   Summary of suggested improvements
   Open Home with a single child's story or a vivid one-paragraph scene from an Aiyur school — before any org description
   Add 2–3 short testimonials (student, volunteer, School Companion) across the site
   Make the problem concrete — one paragraph describing what schooling actually looks like in these hill villages
   Add a "Live Impact" signal — current schools active, current companions deployed
   Create one clear primary CTA per page, with a specific low-friction action (e.g. "Join our next volunteer call — every Friday 8pm")
   Add a "Share Vazhai" section at the bottom of Home with a pre-written WhatsApp/message
   On the Donate page, frame amounts around concrete outcomes: "₹500/month funds one student's materials for a year"
   Want me to go ahead and implement these? Some will need you to supply real stories/quotes, but I can build the structure and write placeholder prompts for where that content should go.

## to run
1. ensure netlify cli is installed
2. run `netlify dev` in the terminal
3. TURNSTILE CLOUDFARE IS USED TO DETECT HUMAN, BUT ITS DISABLED DUE TO SOME ISSUES WHERE IT DIDNT DETECT HUMAN and failed
4. Resend is using VAZHAI.connect gmail account. Api key is needed to send otp for mail authentication