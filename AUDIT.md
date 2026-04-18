# DentalScan AI — Technical and UX Audit

**Auditor:** Koushik Goud Shaganti
**Product:** dentalscan.us — 5-angle Discovery Scan

---

## What Could Be Smoother

The scan starts immediately with no guidance at all. The camera turns on and a button appears but nothing tells you what position to get into first. I tapped straight away without being ready and the photo was completely off.

The instructions for each angle are placed at the bottom of the screen. When you are actively trying to frame your face the eyes naturally stay on the center of the screen, not the bottom. I missed the instructions completely the first few times because of this. Moving the key instruction to the center of the screen, right where the patient is already looking, would make a real difference.

The guiding oval looks like it is doing something but it is not. I tried properly centering my face inside it, waited, and got no confirmation that the position was correct. Then out of curiosity I took a completely random picture without trying at all and it still accepted it and showed a green tick. The oval is just a shape drawn on screen. It does not check anything. The dentist ends up receiving whatever photo was taken whether teeth are visible or not.

On first launch the screen should go dark and show a short animated face demonstrating the correct position before the camera activates for each angle. Something that shows the head turning left, then right, then tilting back with the mouth open wide. Once the animation plays through the camera turns on and you take the picture. A simple line in the center of the screen like "hold phone 30 cm away and open wide" placed right before each capture would already reduce bad photos significantly.

After I took a photo that I knew looked off there was no chance to try again. The app just moved to the next angle. A short prompt saying something like "that one looks a bit off, want to retry" before locking it in would let the patient fix it themselves before submitting.

---

## Mobile Camera Stability Challenges

Holding a phone steady that close to your own face is genuinely difficult. The hand moves slightly the exact moment you tap the button, which is also the same moment the shutter fires. A countdown of 2 to 3 seconds after tapping would let the hand stop moving before the photo is taken.

For left and right angles the natural thing to do is turn both your head and the phone together. I did this myself. There is nothing on screen that tells you to keep the phone still and only move your head. An arrow animation showing the phone staying fixed while just the head rotates would make this clear immediately without needing any text.

For the upper and lower angles you tilt your head back or down but your wrist naturally drops with it, which pulls the camera away from the mouth. A small diagram showing the hand staying at the same height while only the head moves would help a lot here. These two angles had the worst results out of all five in my test.

---

## Technical Risks

The biggest technical problem is that the oval accepts every photo. There is no actual check happening. I have worked with YOLO for object detection before, not in a dental context, but a lightweight version running on device could check whether an open mouth with visible teeth is inside the frame before allowing the capture button to activate. If nothing valid is detected the button stays inactive. This alone would block most of the bad submissions that currently get through.

There are other good model options worth exploring here. A small model trained specifically on dental images could do this more accurately than a general object detector. It is also possible to start with a basic blur score and a brightness threshold as a first pass filter, which is much simpler to build and would already reject the worst frames before anything more advanced is needed.

Wet teeth reflect the phone screen and create bright white spots in the image. The AI can read these as deposits and flag them incorrectly. A single reminder at the start of the scan telling the patient to rinse their mouth would reduce these false readings.

Lighting is never checked. A bright mirror or window behind the patient washes the image out completely. A dark room makes the teeth look grey and flat. A simple brightness reading from the camera with a short warning like "move to better lighting" would catch this before the patient wastes a capture.

---

## Voice Guidance Is Missing

The app is completely silent. At the exact moment the patient is trying to hold the phone steady with one hand and position their face with the other, their eyes are locked on the oval, not on any text block sitting at the edge of the screen. Reading instructions in that position is close to impossible. A calm voice saying "turn your head to the right, a little more, now open wide, hold still for two seconds" would do what text cannot. The browser itself can speak through the built in speech API for free, which makes this cheap to ship. A later upgrade can generate the coaching line with a language model so the voice reacts to what the camera is actually seeing, the same way a real dentist would adjust their words.

A small animated face playing the pose in the corner of the screen while the voice speaks would push this even further. The patient mirrors the demo the same way people copy a yoga video. There is no reading step in between, which removes the pause where most people lose confidence.

---

## The Chatbox Feels Dead

Messages sent from the patient sit there with no response until a human from the clinic happens to open the thread. If the patient writes that their lower left tooth hurts with cold water, they get silence for minutes or hours. Most people assume the message did not go through and close the app.

A short AI reply that arrives within a few seconds would fix this. Something that gives general information, suggests simple temporary steps, and clearly tells the patient that a dentist will review the scan and follow up. The reply should be labelled as coming from an assistant, not from the clinician. The human dentist still owns the conversation and can override. This keeps the chat feeling alive during the window where the clinic has not replied yet, which is the window where the patient decides whether the product is worth staying on.

---

## Holding The Patient Through The Scan

Most people who quit the scan do not quit at the end. They quit after the first or second photo, when they get frustrated and stop trusting that the app knows what it is doing. The product has a very small window to feel friendly and guided, and every point in this audit feeds into that same window.

Voice guidance, a demo face that performs each pose, a proper detector that only unlocks the shutter when the mouth is really open, a quick retake prompt after a bad frame, a live AI reply in the chat, and a small moment of celebration after every successful capture all work together. On their own each one is a small change. Together they turn a flat form into something that feels like a person is walking the patient through it. That is what keeps people on screen until the fifth angle is done, which is the only outcome that matters for the clinic.

---
