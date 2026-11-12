/*
 * Shared by every page in this folder. Talks to the JSON API in server/ (/api/auth/*).
 *
 * Each input declares its rule with data-rule. Validation runs in three moments:
 *   - "input": while typing (real-time feedback)
 *   - "blur":  when leaving the field (also catches fields left empty)
 *   - "submit": when the form is sent
 * The server repeats every check; its answer is what counts.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- API helper

  /** POST JSON and resolve to { status, ok, data }. Network failures resolve with status 0. */
  function api(path, body, method) {
    return fetch("/api/auth/" + path, {
      method: method || "POST",
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { status: res.status, ok: res.ok, data: data };
          });
      })
      .catch(function () {
        return { status: 0, ok: false, data: { error: "Can't reach the server. Check your connection and try again." } };
      });
  }

  // ---------------------------------------------------------------- Dashboard page

  if (document.body.getAttribute("data-page") === "dashboard") {
    var nameSlot = document.getElementById("user-name");
    var signOut = document.getElementById("sign-out");

    api("me", null, "GET").then(function (r) {
      if (!r.ok) return window.location.replace("index.html");
      nameSlot.textContent = r.data.user.name;
    });

    signOut.addEventListener("click", function () {
      setLoading(signOut, true);
      api("logout").then(function () {
        window.location.replace("index.html");
      });
    });
    return;
  }

  var form = document.getElementById("auth-form");
  if (!form) return;

  var submit = form.querySelector('button[type="submit"]');
  var status = document.getElementById("form-status");
  var mode = form.getAttribute("data-mode") || "login";

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var LETTERS_AND_SPACES = /^[\p{L}\s]*$/u;
  var PASSWORD_MAX = 128;

  /* Shown in this order; the length requirement is deliberately last. */
  var PASSWORD_REQUIREMENTS = [
    { text: "Password must contain a lowercase letter", test: function (v) { return /[a-z]/.test(v); } },
    { text: "Password must contain an uppercase letter", test: function (v) { return /[A-Z]/.test(v); } },
    { text: "Password must contain a number", test: function (v) { return /[0-9]/.test(v); } },
    { text: "Password must contain a special character (@#$&*)", test: function (v) { return /[@#$&*]/.test(v); } },
    { text: "Minimum of 8 characters", test: function (v) { return v.length >= 8; } },
  ];

  function labelFor(input) {
    var label = form.querySelector('label[for="' + input.id + '"]');
    return label ? label.textContent.trim() : "This field";
  }

  function emptyMessage(input) {
    return labelFor(input) + " cannot be left empty";
  }

  /*
   * Each rule returns an error message, or "" when the value is fine for this moment.
   * Whitespace-only values count as empty.
   */
  var rules = {
    name: function (value, moment, input) {
      var v = value.trim();
      if (!v) return moment === "input" ? "" : emptyMessage(input);
      if (!LETTERS_AND_SPACES.test(value)) return "Full name can only contain letters";
      // Two-word check waits until the user leaves the field, so it doesn't nag mid-typing.
      if (moment !== "input" && v.split(/\s+/).length < 2) return "Enter your first and last name";
      if (v.length > 100) return "Use 100 characters or fewer";
      return "";
    },

    email: function (value, moment, input) {
      var v = value.trim();
      if (!v) return moment === "input" ? "" : emptyMessage(input);
      if (v.length > 254 || !EMAIL_PATTERN.test(v)) return "Enter a valid email address, like name@example.com";
      return "";
    },

    // Sign in only checks presence; the password policy is not revealed there.
    currentPassword: function (value, moment, input) {
      if (!value) return moment === "input" ? "" : emptyMessage(input);
      return "";
    },

    // The individual requirements are listed separately (see renderRequirements).
    newPassword: function (value, moment, input) {
      if (!value) return moment === "input" ? "" : emptyMessage(input);
      if (value.length > PASSWORD_MAX) return "Use " + PASSWORD_MAX + " characters or fewer";
      if (moment === "submit" && unmetRequirements(value).length) return "Your password doesn't meet the requirements below";
      return "";
    },

    // 6-digit email verification code. Non-digits are flagged as they're typed.
    code: function (value, moment, input) {
      var v = value.trim();
      if (!v) return moment === "input" ? "" : emptyMessage(input);
      if (!/^\d+$/.test(v)) return "The code can only contain numbers";
      if (moment !== "input" && v.length !== 6) return "Enter the 6-digit code from your email";
      return "";
    },

    // Must match the field named in data-match. Checked live once the user starts typing.
    confirmPassword: function (value, moment, input) {
      if (!value) return moment === "input" ? "" : emptyMessage(input);
      var original = document.getElementById(input.getAttribute("data-match"));
      if (original && value !== original.value) return "Passwords do not match";
      return "";
    },
  };

  function unmetRequirements(value) {
    return PASSWORD_REQUIREMENTS.filter(function (r) {
      return !r.test(value);
    });
  }

  var inputs = Array.prototype.slice.call(form.querySelectorAll("input[data-rule]"));

  // ---------------------------------------------------------------- Error display

  function setError(input, message) {
    var error = document.getElementById(input.id + "-error");
    error.textContent = message;
    error.hidden = !message;
  }

  function setInvalid(input, invalid) {
    if (invalid) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  /* Password requirements: only the unmet ones, only once the user has typed something. */
  function renderRequirements(input) {
    var list = document.getElementById(input.id + "-requirements");
    if (!list) return [];

    var unmet = input.value ? unmetRequirements(input.value) : [];
    list.innerHTML = "";
    unmet.forEach(function (r) {
      var li = document.createElement("li");
      li.textContent = r.text;
      list.appendChild(li);
    });
    list.hidden = unmet.length === 0;
    return unmet;
  }

  function validate(input, moment) {
    var message = rules[input.getAttribute("data-rule")](input.value, moment, input);
    var unmet = input.getAttribute("data-rule") === "newPassword" ? renderRequirements(input) : [];
    setError(input, message);
    setInvalid(input, !!message || unmet.length > 0);
    return !message && unmet.length === 0;
  }

  inputs.forEach(function (input) {
    // Real-time: every keystroke, paste or deletion re-checks the field.
    input.addEventListener("input", function () {
      status.textContent = "";
      if (!formError.hidden) showFormError("");
      validate(input, "input");

      // Editing a password re-checks any confirmation field that has already been filled in.
      Array.prototype.forEach.call(form.querySelectorAll('input[data-match="' + input.id + '"]'), function (confirm) {
        if (confirm.value) validate(confirm, "input");
      });
    });

    // Leaving the field: catches empty fields and incomplete names.
    input.addEventListener("blur", function () {
      // Picking an email suggestion with the mouse briefly blurs the field; skip that.
      if (input.getAttribute("data-picking") === "true") return;
      validate(input, "blur");
    });
  });

  // ---------------------------------------------------------------- Show / hide password

  Array.prototype.forEach.call(form.querySelectorAll(".field__toggle"), function (toggle) {
    var input = document.getElementById(toggle.getAttribute("aria-controls"));

    // Keep focus in the input so the toggle doesn't trigger a blur "empty" error.
    toggle.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });

    toggle.addEventListener("click", function () {
      var reveal = input.type === "password";
      var start = input.selectionStart;
      var end = input.selectionEnd;

      input.type = reveal ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(reveal));
      toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");

      input.focus();
      if (start !== null) input.setSelectionRange(start, end);
    });
  });

  function hideAllPasswords() {
    Array.prototype.forEach.call(form.querySelectorAll('.field__toggle[aria-pressed="true"]'), function (t) {
      t.click();
    });
  }

  // ---------------------------------------------------------------- Email suggestions
  // A custom suggestion list replaces the browser's autofill dropdown.

  var DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];

  Array.prototype.forEach.call(form.querySelectorAll('input[data-rule="email"]'), function (input) {
    var control = input.parentElement;
    if (!control.classList.contains("field__control")) {
      control = document.createElement("div");
      control.className = "field__control";
      input.parentNode.insertBefore(control, input);
      control.appendChild(input);
    }

    var list = document.createElement("ul");
    list.className = "suggestions";
    list.id = input.id + "-suggestions";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Email suggestions");
    list.hidden = true;
    control.appendChild(list);

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");

    var options = [];
    var active = -1;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      options = [];
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function highlight(index) {
      active = index;
      options.forEach(function (li, i) {
        li.setAttribute("aria-selected", String(i === index));
      });
      if (index >= 0) input.setAttribute("aria-activedescendant", options[index].id);
      else input.removeAttribute("aria-activedescendant");
    }

    function choose(value) {
      input.value = value;
      close();
      validate(input, "blur");
      input.focus();
    }

    function suggestionsFor(value) {
      var v = value.trim();
      if (!v || /\s/.test(v)) return [];
      var at = v.indexOf("@");
      var local = at === -1 ? v : v.slice(0, at);
      var typedDomain = at === -1 ? "" : v.slice(at + 1).toLowerCase();
      if (!local || v.indexOf("@", at + 1) !== -1) return [];
      return DOMAINS.filter(function (d) {
        return d.indexOf(typedDomain) === 0 && d !== typedDomain;
      }).map(function (d) {
        return { value: local + "@" + d, typed: at === -1 ? local : v };
      });
    }

    function render() {
      var items = suggestionsFor(input.value);
      if (!items.length) return close();

      list.innerHTML = "";
      options = items.map(function (item, i) {
        var li = document.createElement("li");
        li.id = list.id + "-" + i;
        li.className = "suggestions__item";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");

        // The part already typed is plain; the completion is bold.
        var typed = document.createElement("span");
        typed.textContent = item.value.slice(0, item.typed.length);
        var rest = document.createElement("strong");
        rest.textContent = item.value.slice(item.typed.length);
        li.appendChild(typed);
        li.appendChild(rest);

        // mousedown fires before the input's blur; flag it so blur doesn't validate a half-typed value.
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          input.setAttribute("data-picking", "true");
        });
        li.addEventListener("click", function () {
          input.removeAttribute("data-picking");
          choose(item.value);
        });
        list.appendChild(li);
        return li;
      });

      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight(-1);
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("blur", function () {
      if (input.getAttribute("data-picking") !== "true") close();
    });

    input.addEventListener("keydown", function (e) {
      if (list.hidden) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlight((active + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlight(active <= 0 ? options.length - 1 : active - 1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        choose(suggestionsFor(input.value)[active].value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        close();
      }
    });
  });

  // ---------------------------------------------------------------- Loading state

  /*
   * Puts a spinner and the button's data-pending text in place of its label, and disables it
   * so a double click can't send twice. setLoading(button, false) restores data-label.
   */
  function setLoading(button, loading) {
    button.disabled = loading;
    button.setAttribute("aria-busy", String(loading));
    button.innerHTML = "";
    if (loading) {
      var spinner = document.createElement("span");
      spinner.className = "spinner";
      spinner.setAttribute("aria-hidden", "true");
      button.appendChild(spinner);
      button.appendChild(document.createTextNode(button.getAttribute("data-pending") || "Loading…"));
    } else {
      button.appendChild(document.createTextNode(button.getAttribute("data-label") || "Submit"));
    }
  }

  // ---------------------------------------------------------------- Server responses

  /* Form-level message (wrong password, rate limited, server unreachable…), announced immediately. */
  var formError = document.createElement("p");
  formError.className = "form__error";
  formError.setAttribute("role", "alert");
  formError.tabIndex = -1;
  formError.hidden = true;
  form.insertBefore(formError, form.firstChild);

  function showFormError(message) {
    formError.textContent = message || "";
    formError.hidden = !message;
    if (message) formError.focus();
  }

  /* Shows the server's per-field messages exactly like the browser's own, then focuses the first. */
  function showFieldErrors(errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var input = form.elements[name];
      if (!input || !input.id) return;
      setError(input, errors[name]);
      setInvalid(input, true);
      if (!first) first = input;
    });
    if (first) first.focus();
    return !!first;
  }

  function handleFailure(r) {
    if (r.data && r.data.fieldErrors && showFieldErrors(r.data.fieldErrors)) return;
    showFormError((r.data && r.data.error) || "Something went wrong. Please try again.");
  }

  /* What to send, and what to do on success, for each page. */
  var resetToken = null;
  var ACTIONS = {
    login: {
      path: "login",
      body: function () {
        return { email: form.elements.email.value, password: form.elements.password.value };
      },
      done: function () {
        window.location.assign("dashboard.html");
      },
    },
    signup: {
      path: "signup",
      body: function () {
        return { name: form.elements.name.value, email: form.elements.email.value, password: form.elements.password.value };
      },
      done: function () {
        window.location.assign("dashboard.html");
      },
    },
    forgot: {
      path: "forgot-password",
      body: function () {
        return { email: form.elements.email.value };
      },
      done: showSuccessView,
    },
    reset: {
      path: "reset-password",
      body: function () {
        return {
          token: resetToken,
          password: form.elements.password.value,
          confirmPassword: form.elements.confirmPassword.value,
        };
      },
      done: showSuccessView,
    },
    verify: {
      path: "verify-email",
      body: function () {
        return { code: form.elements.code.value.trim() };
      },
      done: function () {
        window.location.assign("dashboard.html");
      },
    },
  };

  // ---------------------------------------------------------------- Reset page: check the link first

  if (mode === "reset") {
    var invalidView = document.getElementById("invalid-view");
    var formViewEl = document.getElementById("form-view");
    var showInvalid = function () {
      formViewEl.hidden = true;
      invalidView.hidden = false;
    };

    resetToken = new URLSearchParams(window.location.search).get("token");
    if (resetToken) {
      // Keep the token out of the address bar and browser history from here on.
      window.history.replaceState(null, "", window.location.pathname);
      api("reset-password/validate?token=" + encodeURIComponent(resetToken), null, "GET").then(function (r) {
        if (!r.ok || !r.data.valid) showInvalid();
      });
    } else {
      showInvalid();
    }
  }

  // ---------------------------------------------------------------- Submit

  function showSuccessView() {
    var view = document.getElementById(form.getAttribute("data-success"));
    var formView = document.getElementById("form-view");
    if (!view) return false;

    // Copy submitted values into the confirmation text (e.g. the email address).
    Array.prototype.forEach.call(view.querySelectorAll("[data-fill]"), function (el) {
      var source = form.elements[el.getAttribute("data-fill")];
      el.textContent = source ? source.value.trim() : "";
    });

    if (formView) formView.hidden = true;
    view.hidden = false;
    var heading = view.querySelector("h1");
    if (heading) heading.focus();
    return true;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submit.disabled) return;
    status.textContent = "";

    var firstInvalid = null;
    inputs.forEach(function (input) {
      if (!validate(input, "submit") && !firstInvalid) firstInvalid = input;
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    // Never leave a password readable after submitting.
    hideAllPasswords();

    showFormError("");
    var action = ACTIONS[mode];
    setLoading(submit, true);
    api(action.path, action.body()).then(function (r) {
      if (r.ok) {
        // New sign-up, or a login whose email was never verified: go enter the code.
        // (The button stays in its loading state while the browser navigates away.)
        if (r.data && r.data.next === "verify") return window.location.assign("verify-email.html");
        if (mode === "login" || mode === "signup" || mode === "verify") return action.done();
        setLoading(submit, false);
        return action.done();
      }
      setLoading(submit, false);
      if (mode === "login" && r.status === 429 && r.data && r.data.retryAfterSec) {
        return startLockout(Date.now() + r.data.retryAfterSec * 1000);
      }
      handleFailure(r);
    });
  });

  // ---------------------------------------------------------------- Sign-in lockout
  /*
   * After too many wrong passwords the server refuses sign-in for a while (5 minutes) and says
   * how many seconds are left. Until then the password field, its eye toggle and the button are
   * switched off, and a live countdown shows the wait. The server still enforces the lock;
   * this just stops the user from typing into a form that can't work yet.
   */
  if (mode === "login") {
    var LOCK_KEY = "shrink:login-locked-until";
    var passwordInput = form.elements.password;
    var passwordToggle = form.querySelector('.field__toggle[aria-controls="password"]');
    var lockTimer = null;

    var clock = function (sec) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    };

    var setLocked = function (locked) {
      passwordInput.disabled = locked;
      if (passwordToggle) passwordToggle.disabled = locked;
      submit.disabled = locked;
    };

    var endLockout = function () {
      clearInterval(lockTimer);
      try {
        sessionStorage.removeItem(LOCK_KEY);
      } catch (e) {}
      setLocked(false);
      showFormError("");
      status.textContent = "You can try signing in again.";
      passwordInput.focus();
    };

    var startLockout = function (until) {
      try {
        sessionStorage.setItem(LOCK_KEY, String(until));
      } catch (e) {}
      var secondsLeft = function () {
        return Math.ceil((until - Date.now()) / 1000);
      };
      if (secondsLeft() <= 0) return endLockout();

      hideAllPasswords();
      passwordInput.value = "";
      setError(passwordInput, "");
      setInvalid(passwordInput, false);
      setLocked(true);

      // The ticking digits are hidden from screen readers (they'd be read out every second);
      // the spoken version says the wait once, in minutes.
      var digits = document.createElement("span");
      digits.className = "form__countdown";
      digits.setAttribute("aria-hidden", "true");
      var spoken = document.createElement("span");
      spoken.className = "visually-hidden";
      var mins = Math.ceil(secondsLeft() / 60);
      spoken.textContent = mins + (mins === 1 ? " minute" : " minutes");

      formError.textContent = "Too many incorrect attempts. Try again in ";
      formError.appendChild(digits);
      formError.appendChild(spoken);
      formError.appendChild(document.createTextNode("."));
      formError.hidden = false;
      formError.focus();

      var tick = function () {
        var left = secondsLeft();
        if (left <= 0) return endLockout();
        digits.textContent = clock(left);
      };
      tick();
      clearInterval(lockTimer);
      lockTimer = setInterval(tick, 1000);
    };

    // A refresh mid-countdown keeps the form locked.
    try {
      var savedUntil = Number(sessionStorage.getItem(LOCK_KEY));
      if (savedUntil > Date.now()) startLockout(savedUntil);
      else sessionStorage.removeItem(LOCK_KEY);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- Resend (forgot password + verify email)

  var resend = document.getElementById("resend");
  if (resend) {
    // Each page names its endpoint and confirmation text on the button.
    var resendPath = resend.getAttribute("data-path") || "forgot-password";
    var resendBody = function () {
      return resendPath === "forgot-password" ? { email: form.elements.email.value } : {};
    };
    var sentMessage = resend.getAttribute("data-sent") || "We've sent another link. It can take a minute to arrive.";
    var resendStatus = document.getElementById("resend-status");
    var cooldown = Number(resend.getAttribute("data-cooldown")) || 60;
    var timer = null;

    function startCooldown(seconds) {
      if (timer) window.clearInterval(timer);
      var remaining = seconds;
      var label = resend.getAttribute("data-label");
      resend.disabled = true;
      resend.textContent = label + " in " + remaining + "s";
      timer = window.setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(timer);
          resend.disabled = false;
          resend.textContent = label;
        } else {
          resend.textContent = label + " in " + remaining + "s";
        }
      }, 1000);
    }

    resend.addEventListener("click", function () {
      if (resend.disabled) return;
      resendStatus.textContent = "";
      setLoading(resend, true);
      api(resendPath, resendBody()).then(function (r) {
        setLoading(resend, false);
        if (r.ok) {
          resendStatus.textContent = sentMessage;
          startCooldown((r.data && r.data.retryAfterSec) || cooldown);
        } else {
          if (r.status === 401) return window.location.replace("index.html");
          resendStatus.textContent = (r.data && r.data.error) || "Couldn't send it. Please try again.";
          // The server says how long to wait; mirror it on the button.
          if (r.data && r.data.retryAfterSec) startCooldown(Math.min(r.data.retryAfterSec, 3600));
        }
      });
    });

    // The first email was just sent, so start in cooldown once the confirmation appears.
    var successView = document.getElementById(form.getAttribute("data-success"));
    if (successView && "MutationObserver" in window) {
      new MutationObserver(function () {
        if (!successView.hidden && !timer) startCooldown(cooldown);
      }).observe(successView, { attributes: true, attributeFilter: ["hidden"] });
    }

    // Verify page: ask the server which email we're verifying and how long until resend unlocks.
    if (mode === "verify") {
      api("verify-email/status", null, "GET").then(function (r) {
        if (!r.ok) return window.location.replace("index.html");
        Array.prototype.forEach.call(document.querySelectorAll('[data-fill="pending-email"]'), function (el) {
          el.textContent = r.data.email;
        });
        if (r.data.retryAfterSec > 0) startCooldown(r.data.retryAfterSec);
      });
    }
  }

  // ---------------------------------------------------------------- "Use a different email"

  var changeEmail = document.getElementById("change-email");
  if (changeEmail) {
    changeEmail.addEventListener("click", function () {
      setLoading(changeEmail, true);
      api("verify-email/cancel").then(function () {
        window.location.assign("sign-up.html");
      });
    });
  }
})();
