import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

type IconName = keyof typeof Ionicons.glyphMap;
type TabName = "Home" | "Sell" | "Kitchen" | "Stock" | "More";
type KitchenStatus = "new" | "preparing" | "ready";
type StockAction = "receive" | "waste" | "adjust";
type Role = "owner" | "manager" | "cashier" | "kitchen";

const tabs: { label: TabName; icon: IconName; activeIcon: IconName }[] = [
  { label: "Home", icon: "home-outline", activeIcon: "home" },
  { label: "Kitchen", icon: "restaurant-outline", activeIcon: "restaurant" },
  { label: "Sell", icon: "add", activeIcon: "add" },
  { label: "Stock", icon: "cube-outline", activeIcon: "cube" },
  { label: "More", icon: "grid-outline", activeIcon: "grid" },
];

type MenuItem = { key: string; name: string; description: string; priceKobo: number; category: string; icon: IconName; color: string; soldOut: boolean; menuItemId?: Id<"menuItems"> };

const fallbackMenuItems: MenuItem[] = [
  { key: "jollof-chicken", name: "Jollof rice & chicken", description: "Smoky jollof, grilled chicken", priceKobo: 450000, category: "Mains", icon: "restaurant-outline" as IconName, color: "#F4E1D5", soldOut: false },
  { key: "suya-platter", name: "Suya platter", description: "Spiced beef, onions, yaji", priceKobo: 600000, category: "Mains", icon: "flame-outline" as IconName, color: "#F3D9C3", soldOut: false },
  { key: "pepper-soup", name: "Goat pepper soup", description: "Slow-cooked, aromatic broth", priceKobo: 520000, category: "Mains", icon: "water-outline" as IconName, color: "#E4E7D3", soldOut: false },
  { key: "fried-plantain", name: "Fried plantain", description: "Golden, sweet plantain", priceKobo: 180000, category: "Sides", icon: "leaf-outline" as IconName, color: "#F5E7B8", soldOut: false },
  { key: "coleslaw", name: "Fresh coleslaw", description: "Cabbage, carrot, light dressing", priceKobo: 150000, category: "Sides", icon: "nutrition-outline" as IconName, color: "#DDEAD6", soldOut: false },
  { key: "zobo", name: "Zobo cooler", description: "Chilled hibiscus and spice", priceKobo: 120000, category: "Drinks", icon: "wine-outline" as IconName, color: "#EDD7E1", soldOut: false },
  { key: "chapman", name: "Chapman", description: "Citrus, bitters, cucumber", priceKobo: 200000, category: "Drinks", icon: "cafe-outline" as IconName, color: "#F2DCCB", soldOut: false },
  { key: "chin-chin", name: "Chin chin bowl", description: "Crunchy house-made bites", priceKobo: 150000, category: "Snacks", icon: "fast-food-outline" as IconName, color: "#EFE3B9", soldOut: false },
];

type Cart = Record<string, { item: MenuItem; quantity: number }>;
type PaymentMethod = "cash" | "card" | "transfer";
type PendingPayment = { orderId: Id<"orders">; number: string; totalKobo: number; itemCount: number };

const DRAFT_KEY = "@nectar/pos-draft";
const INSTALL_DISMISSED_KEY = "@nectar/install-dismissed";
export default function Index() {
  const [tab, setTab] = useState<TabName>("Home");
  const [cart, setCart] = useState<Cart>({});
  const [orderType, setOrderType] = useState<"dine-in" | "takeaway">("dine-in");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [packagingFee, setPackagingFee] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [role, setRole] = useState<Role>("cashier");
  const [seedRequested, setSeedRequested] = useState(false);
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const currentStaff = useQuery(api.team.current, isAuthenticated ? {} : "skip");
  const liveMenu = useQuery(api.menu.list, isAuthenticated ? {} : "skip");
  const seedDefaults = useMutation(api.menu.seedDefaults);
  const insets = useSafeAreaInsets();
  const navigateToTab = (nextTab: TabName) => {
    if (role === "kitchen" && !["Home", "Kitchen", "More"].includes(nextTab)) return;
    if (role === "cashier" && nextTab === "Stock") return;
    setTab(nextTab);
  };

  useEffect(() => {
    if (!isAuthenticated || role !== "owner" || liveMenu?.length !== 0 || seedRequested) return;
    setSeedRequested(true);
    seedDefaults({}).catch(() => setSeedRequested(false));
  }, [isAuthenticated, liveMenu, role, seedDefaults, seedRequested]);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((stored) => {
        if (!stored) return;
        const draft = JSON.parse(stored) as { cart?: Cart; orderType?: "dine-in" | "takeaway"; deliveryFee?: string; packagingFee?: string };
        if (draft.cart) setCart(draft.cart);
        if (draft.orderType) setOrderType(draft.orderType);
        if (draft.deliveryFee) setDeliveryFee(draft.deliveryFee);
        if (draft.packagingFee) setPackagingFee(draft.packagingFee);
      })
      .catch(() => undefined)
      .finally(() => setDraftReady(true));
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, orderType, deliveryFee, packagingFee })).catch(() => undefined);
  }, [cart, deliveryFee, draftReady, orderType, packagingFee]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (currentStaff?.role === "owner" || currentStaff?.role === "manager" || currentStaff?.role === "cashier" || currentStaff?.role === "kitchen") setRole(currentStaff.role);
  }, [currentStaff?.role]);

  if (isLoading) return <View style={styles.authLoading}><ActivityIndicator size="large" color="#A84629" /></View>;
  if (!isAuthenticated) return <SignInScreen />;
  if (!currentStaff) return <View style={styles.authLoading}><ActivityIndicator size="large" color="#A84629" /></View>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" />
      {tab === "Home" ? (
        <HomeScreen onNavigate={navigateToTab} role={role} staffName={currentStaff.name} />
      ) : tab === "Sell" ? (
        <SellScreen
          bottomInset={insets.bottom}
          role={role}
          cart={cart}
          setCart={setCart}
          orderType={orderType}
          setOrderType={setOrderType}
          deliveryFee={deliveryFee}
          setDeliveryFee={setDeliveryFee}
          packagingFee={packagingFee}
          setPackagingFee={setPackagingFee}
        />
      ) : tab === "Kitchen" ? (
        <KitchenScreen bottomInset={insets.bottom} />
      ) : tab === "Stock" ? (
        <StockScreen bottomInset={insets.bottom} />
      ) : (
        <MoreScreen bottomInset={insets.bottom} role={role} onSignOut={() => signOut()} />
      )}
      <TabBar tab={tab} onChange={navigateToTab} bottomInset={insets.bottom} role={role} />
      <InstallBanner bottomOffset={insets.bottom + 92} />
    </SafeAreaView>
  );
}

function SignInScreen() {
  const { signIn } = useAuthActions();
  const setupStatus = useQuery(api.team.setupStatus);
  const bootstrapOwner = useMutation(api.team.bootstrapOwner);
  const recoverOwnerPin = useMutation(api.team.recoverOwnerPin);
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoverMode, setRecoverMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRun = setupStatus?.ownerExists === false;
  const submit = async () => {
    if (firstRun) {
      if (!name.trim()) { setError("Enter the owner's name to set up the restaurant."); return; }
      if (pin.length !== 6 || recoveryPin.length !== 6) { setError("Enter a six-digit PIN and a six-digit recovery PIN."); return; }
      setBusy(true); setError(null);
      try {
        await bootstrapOwner({ name: name.trim(), phone, pin, recoveryPin });
        setRecoverMode(false);
        await signIn("phone-pin", { phone: normalizePhoneForLogin(phone), pin });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not set up the owner account.");
      } finally { setBusy(false); }
      return;
    }
    if (recoverMode) {
      if (pin.length !== 6 || recoveryPin.length !== 6) { setError("Enter your recovery PIN and a new six-digit PIN."); return; }
      setBusy(true); setError(null);
      try {
        await recoverOwnerPin({ phone: normalizePhoneForLogin(phone), recoveryPin, newPin: pin });
        setRecoverMode(false);
        setRecoveryPin("");
        await signIn("phone-pin", { phone: normalizePhoneForLogin(phone), pin });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Recovery failed. Check the phone number and recovery PIN.");
      } finally { setBusy(false); }
      return;
    }
    if (pin.length !== 6) { setError("Enter your six-digit PIN."); return; }
    setBusy(true); setError(null);
    try {
      await signIn("phone-pin", { phone: normalizePhoneForLogin(phone), pin });
    } catch (e) {
      setError("Phone number or PIN is incorrect. Check with the restaurant owner if you need help.");
    } finally { setBusy(false); }
  };
  const toSignIn = () => { setRecoverMode(false); setRecoveryPin(""); setPin(""); setError(null); };
  return (
    <SafeAreaView style={styles.signInScreen}>
      <KeyboardAvoidingView style={styles.signInContent} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View>
        <View style={styles.signInMark}><BrandMark size={34} /></View>
        <Text style={styles.signInTitle}>{firstRun ? "Set up your restaurant." : recoverMode ? "Recover owner PIN" : "Welcome back."}</Text>
        <Text style={styles.signInCopy}>{firstRun ? "Create the owner account first. You’ll create staff accounts and hand each person their PIN. Keep the recovery PIN somewhere safe — it is the only way back in if the owner PIN is forgotten." : recoverMode ? "Enter your phone number, the owner recovery PIN from setup, and a new PIN to sign in." : "Sign in with the phone number and six-digit PIN given to you by the owner."}</Text>
        {firstRun && <><Text style={styles.receiveLabel}>Owner name</Text><View style={styles.reasonInputWrap}><TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor="#A0A49D" style={styles.reasonInput} autoCapitalize="words" /></View></>}
        <Text style={styles.receiveLabel}>{recoverMode ? "Owner phone number" : "Phone number"}</Text><View style={styles.reasonInputWrap}><TextInput value={phone} onChangeText={(v) => { setPhone(v); setError(null); }} placeholder="080 1234 5678" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="phone-pad" autoComplete="tel" /></View>
        {recoverMode ? <>
          <Text style={styles.receiveLabel}>Recovery PIN</Text><View style={styles.reasonInputWrap}><TextInput value={recoveryPin} onChangeText={(v) => { const clean = v.replace(/\D/g, "").slice(0, 6); setRecoveryPin(clean); setError(null); if (clean.length === 6) Keyboard.dismiss(); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>
          <Text style={styles.receiveLabel}>New 6-digit PIN</Text><View style={styles.reasonInputWrap}><TextInput value={pin} onChangeText={(v) => { const clean = v.replace(/\D/g, "").slice(0, 6); setPin(clean); setError(null); if (clean.length === 6) Keyboard.dismiss(); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>
        </> : <>
          {firstRun ? <>
            <Text style={styles.receiveLabel}>6-digit PIN</Text><View style={styles.reasonInputWrap}><TextInput value={pin} onChangeText={(v) => { const clean = v.replace(/\D/g, "").slice(0, 6); setPin(clean); setError(null); if (clean.length === 6) Keyboard.dismiss(); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>
            <Text style={styles.receiveLabel}>6-digit recovery PIN</Text><View style={styles.reasonInputWrap}><TextInput value={recoveryPin} onChangeText={(v) => { const clean = v.replace(/\D/g, "").slice(0, 6); setRecoveryPin(clean); setError(null); if (clean.length === 6) Keyboard.dismiss(); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>
          </> : <Text style={styles.receiveLabel}>6-digit PIN</Text>}
          {!firstRun && <View style={styles.reasonInputWrap}><TextInput value={pin} onChangeText={(v) => { const clean = v.replace(/\D/g, "").slice(0, 6); setPin(clean); setError(null); if (clean.length === 6) Keyboard.dismiss(); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>}
        </>}
        {error && <Text style={styles.signInError}>{error}</Text>}
        <Pressable style={[styles.signInButton, busy && styles.signInButtonDisabled]} onPress={submit} disabled={busy || !setupStatus}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.signInButtonText}>{firstRun ? "Create owner account" : recoverMode ? "Recover and sign in" : "Sign in"}</Text><Ionicons name="arrow-forward" size={19} color="#FFFFFF" /></>}
        </Pressable>
        {!firstRun && (recoverMode
          ? <Pressable onPress={toSignIn} style={styles.signInForgot}><Ionicons name="arrow-back" size={16} color="#8C8177" /><Text style={styles.signInForgotText}>Back to sign in</Text></Pressable>
          : <Pressable onPress={() => { setRecoverMode(true); setError(null); }} style={styles.signInForgot}><Ionicons name="lock-open-outline" size={16} color="#8C8177" /><Text style={styles.signInForgotText}>Owner forgot PIN? Recover</Text></Pressable>)}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
      <InstallBanner bottomOffset={insets.bottom + 16} />
    </SafeAreaView>
  );
}

function normalizePhoneForLogin(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+234${compact.slice(1)}`;
  return `+${compact}`;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isMobileBrowser() {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandaloneBrowser() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return Boolean(media || (navigator as Navigator & { standalone?: boolean }).standalone);
}

function InstallBanner({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const [visible, setVisible] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(INSTALL_DISMISSED_KEY, "1").catch(() => undefined);
  };
  useEffect(() => {
    if (!isMobileBrowser() || isStandaloneBrowser()) return;
    let cancelled = false;
    AsyncStorage.getItem(INSTALL_DISMISSED_KEY).then((dismissed) => {
      if (cancelled || dismissed) return;
      const ua = navigator.userAgent ?? "";
      setIsIos(/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));
      setVisible(true);
    }).catch(() => undefined);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (cancelled) return;
      setPromptEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!visible) return null;
  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => undefined);
    if (choice?.outcome === "dismissed") dismiss();
    else setVisible(false);
  };
  return (
    <View style={[styles.installBanner, { bottom: bottomOffset }]}>
      <View style={styles.installIcon}><Ionicons name="download-outline" size={20} color="#A84629" /></View>
      <View style={styles.installTextWrap}>
        <Text style={styles.installTitle}>Install Nectar</Text>
        <Text style={styles.installCopy}>{isIos ? "Tap the Share icon, then “Add to Home Screen”." : "Add it to your home screen to use it like an app."}</Text>
      </View>
      {!isIos && promptEvent && <Pressable style={styles.installButton} onPress={install}><Text style={styles.installButtonText}>Install</Text></Pressable>}
      <Pressable onPress={dismiss} hitSlop={10} style={styles.installClose}><Ionicons name="close" size={18} color="#8C8177" /></Pressable>
    </View>
  );
}

function HomeScreen({ onNavigate, role, staffName }: { onNavigate: (tab: TabName) => void; role: Role; staffName: string }) {
  const canSeeStockSignals = role === "owner" || role === "manager";
  const ingredients = useQuery(api.inventory.listIngredients, canSeeStockSignals ? {} : "skip");
  const unpaidOrders = useQuery(api.orders.unpaid, role === "kitchen" ? "skip" : {});
  const missingRecipes = useQuery(api.menu.missingRecipes, canSeeStockSignals ? {} : "skip");
  const todayBounds = getTodayBounds();
  const dailySummary = useQuery(api.money.summary, canSeeStockSignals ? todayBounds : "skip");
  const weekBounds = getRangeBounds(7);
  const weekSeries = useQuery(api.reports.salesSeries, canSeeStockSignals ? weekBounds : "skip");
  const weekComparison = useQuery(api.reports.weeklyComparison, canSeeStockSignals ? weekBounds : "skip");
  const bestSellers = useQuery(api.reports.topItems, canSeeStockSignals ? { ...weekBounds, limit: 3 } : "skip");
  const currentShift = useQuery(api.shifts.current, canSeeStockSignals ? {} : "skip");
  const closedShifts = useQuery(api.shifts.recentClosed, canSeeStockSignals ? {} : "skip");
  const activeOrders = useQuery(api.orders.active);
  const attentionLoading = (canSeeStockSignals && (ingredients === undefined || missingRecipes === undefined)) || (role !== "kitchen" && unpaidOrders === undefined);
  const lowIngredients = ingredients?.filter((ingredient) => ingredient.quantity <= ingredient.lowStockLevel) ?? [];
  const unpaidTotalKobo = unpaidOrders?.reduce((sum, order) => sum + order.totalKobo, 0) ?? 0;
  const liveAttention = role === "kitchen"
    ? []
    : role === "cashier"
      ? unpaidOrders === undefined
        ? []
        : unpaidOrders.length
          ? [{ icon: "card-outline" as IconName, title: `${unpaidOrders.length} order${unpaidOrders.length === 1 ? "" : "s"} need payment`, detail: `${formatNaira(unpaidTotalKobo)} total`, tone: "#C69B3B" }]
          : []
      : [
        ...(lowIngredients.length ? [{ icon: "cube-outline" as IconName, title: `${lowIngredients.length} stock item${lowIngredients.length === 1 ? "" : "s"} running low`, detail: lowIngredients.slice(0, 2).map((item) => item.name).join(", "), tone: "#E98B5A" }] : []),
        ...(unpaidOrders?.length ? [{ icon: "card-outline" as IconName, title: `${unpaidOrders.length} order${unpaidOrders.length === 1 ? "" : "s"} need payment`, detail: `${formatNaira(unpaidTotalKobo)} total`, tone: "#C69B3B" }] : []),
        ...(missingRecipes?.length ? [{ icon: "receipt-outline" as IconName, title: `${missingRecipes.length} item${missingRecipes.length === 1 ? " has" : "s have"} no recipe`, detail: "Food cost unavailable", tone: "#718765" }] : []),
      ];
  const visibleAttention = liveAttention;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topbar}>
        <View>
          <Text style={styles.eyebrow}>{new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</Text>
          <Text style={styles.greeting}>{getGreeting()}, {staffName.split(" ")[0]}</Text>
        </View>
        <BrandMark size={32} />
      </View>

      {(role === "owner" || role === "manager") && <>
      <ImageBackground source={require("../assets/nectar-food-hero-mobile.png")} style={styles.salesCard} imageStyle={styles.salesCardImage}>
        <View style={styles.salesOverlay} />
        <View style={styles.salesTop}>
          <View>
            <Text style={styles.salesLabel}>TODAY&apos;S NET SALES</Text>
            <Text style={styles.salesValue}>{dailySummary ? formatNaira(dailySummary.netCollectedKobo) : "Loading…"}</Text>
          </View>
          <View style={styles.trendPill}><Ionicons name="receipt-outline" size={12} color="#1F4A2B" /><Text style={styles.trendText}>Live</Text></View>
        </View>
        <View style={styles.salesFooter}>
          <Text style={styles.salesHint}>{dailySummary ? `${dailySummary.orderCount} order${dailySummary.orderCount === 1 ? "" : "s"} today` : "Loading today’s orders…"}</Text>
          <Text style={styles.salesLink}>{dailySummary ? `${formatNaira(dailySummary.collectedKobo)} collected` : ""}</Text>
        </View>
      </ImageBackground>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: "#F2E9CB" }]}><Ionicons name="wallet-outline" size={19} color="#8A702D" /></View>
          <Text style={styles.statLabel}>Cash expected</Text>
          <Text style={styles.statValue}>{currentShift ? formatNaira(currentShift.expectedCashKobo) : "No open shift"}</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: "#F7E4DC" }]}><Ionicons name="alert-circle-outline" size={19} color="#AF5A3C" /></View>
          <Text style={styles.statLabel}>Last shift difference</Text>
          <Text style={[styles.statValue, { color: (closedShifts?.[0]?.differenceKobo ?? 0) < 0 ? "#B45638" : "#557451" }]}>{closedShifts?.[0]?.differenceKobo === undefined ? "No closed shift" : `${closedShifts[0].differenceKobo < 0 ? "−" : "+"}${formatNaira(Math.abs(closedShifts[0].differenceKobo))}`}</Text>
        </View>
      </View>
      </>}

      <Text style={styles.sectionTitle}>Quick actions</Text>
      <View style={styles.quickRow}>
        {role !== "kitchen" && <QuickAction label="New sale" icon="add" primary onPress={() => onNavigate("Sell")} />}
        {(role === "owner" || role === "manager") && <QuickAction label="Add stock" icon="cube-outline" onPress={() => onNavigate("Stock")} />}
        {(role === "owner" || role === "manager") && <QuickAction label="Expense" icon="receipt-outline" onPress={() => onNavigate("More")} />}
        {role !== "kitchen" && <QuickAction label="Close shift" icon="lock-closed-outline" onPress={() => onNavigate("More")} />}
      </View>

      <SectionHeader title="Needs attention" badge={String(visibleAttention.length)} action="See all" />
      {attentionLoading ? <View style={styles.allClearCard}><ActivityIndicator color="#557451" /><Text style={styles.itemMeta}>Checking live restaurant activity…</Text></View> : visibleAttention.length ? (
        <View style={styles.groupedList}>
          {visibleAttention.map((item, index) => (
            <Pressable key={item.title} style={[styles.attentionItem, index < visibleAttention.length - 1 && styles.divider]} onPress={() => item.icon === "cube-outline" ? onNavigate("Stock") : item.icon === "card-outline" ? onNavigate("Sell") : onNavigate("More")}>
              <View style={[styles.attentionIcon, { backgroundColor: `${item.tone}18` }]}>
                <Ionicons name={item.icon} size={20} color={item.tone} />
              </View>
              <View style={styles.attentionCopy}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemMeta}>{item.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#B3B5AD" />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.allClearCard}><View style={styles.allClearIcon}><Ionicons name="checkmark" size={23} color="#4E754D" /></View><View><Text style={styles.itemTitle}>All clear</Text><Text style={styles.itemMeta}>No stock, recipe, or payment issues right now.</Text></View></View>
      )}

      {(role === "owner" || role === "manager") && <>
      <SectionHeader title="This week" badge={weekComparison ? formatPercent(weekComparison.changePct) : "…"} action="Reports" onAction={() => onNavigate("More")} />
      <View style={styles.weekCard}>
        <View style={styles.weekChart}>
          {(weekSeries ?? []).map((day) => {
            const max = Math.max(1, ...(weekSeries ?? []).map((row) => row.salesKobo));
            return <View key={day.at} style={styles.weekBarColumn}><View style={styles.weekBarTrack}><View style={[styles.weekBarFill, { height: `${Math.max(3, Math.round((day.salesKobo / max) * 100))}%` }]} /></View><Text style={styles.weekBarLabel}>{new Date(day.at).toLocaleDateString("en-NG", { weekday: "narrow" })}</Text></View>;
          })}
        </View>
        <View style={styles.weekTotals}>
          <View style={styles.weekTotalBlock}><Text style={styles.moneyMetricLabel}>This week</Text><Text style={styles.moneyMetricValue}>{formatNaira(weekComparison?.currentKobo ?? 0)}</Text></View>
          <View style={styles.weekTotalBlock}><Text style={styles.moneyMetricLabel}>Previous week</Text><Text style={styles.moneyMetricValue}>{formatNaira(weekComparison?.previousKobo ?? 0)}</Text></View>
          <View style={styles.weekTotalBlock}><Text style={styles.moneyMetricLabel}>Change</Text><Text style={[styles.moneyMetricValue, { color: (weekComparison?.changeKobo ?? 0) < 0 ? "#B45638" : "#557451" }]}>{weekComparison ? `${weekComparison.changeKobo >= 0 ? "+" : "−"}${formatNaira(Math.abs(weekComparison.changeKobo))}` : "—"}</Text></View>
        </View>
      </View>

      <SectionHeader title="Best sellers" badge="This week" action="Reports" onAction={() => onNavigate("More")} />
      {bestSellers?.length ? <View style={styles.groupedList}>{bestSellers.map((item, index) => <View key={item.name} style={[styles.attentionItem, index < bestSellers.length - 1 && styles.divider]}><View style={styles.rankBadge}><Text style={styles.rankText}>{index + 1}</Text></View><View style={styles.attentionCopy}><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.itemMeta}>{formatNaira(item.revenueKobo)}</Text></View><Text style={styles.rankQty}>{item.quantity}</Text></View>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No sales yet this week.</Text></View>}
      </>}

      <SectionHeader title="In the kitchen" badge={activeOrders === undefined ? "…" : `${activeOrders.length} active`} action="Open kitchen" onAction={() => onNavigate("Kitchen")} />
      <View style={styles.orderList}>
        {activeOrders === undefined ? <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>Loading kitchen tickets…</Text></View> : activeOrders.length === 0 ? <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No active kitchen tickets.</Text></View> : activeOrders.slice(0, 3).map((order) => {
          const tone = order.status === "ready" ? "#5D7E58" : order.status === "preparing" ? "#D89931" : "#C86545";
          const ageMinutes = Math.max(0, Math.floor((Date.now() - order.createdAt) / 60000));
          return <Pressable key={order._id} style={styles.orderCard} onPress={() => onNavigate("Kitchen")}>
            <View style={styles.orderMain}>
              <View style={styles.orderHeading}>
                <Text style={styles.orderNumber}>{order.number}</Text>
                <View style={[styles.statusPill, { backgroundColor: `${tone}18` }]}>
                  <View style={[styles.statusDot, { backgroundColor: tone }]} />
                  <Text style={[styles.statusText, { color: tone }]}>{formatOrderStatus(order.status)}</Text>
                </View>
              </View>
              <Text style={styles.orderItems}>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}</Text>
            </View>
            <View style={styles.timeBlock}>
              <Text style={styles.timeValue}>{ageMinutes}</Text>
              <Text style={styles.timeUnit}>min</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </ScrollView>
  );
}

function SellScreen({
  bottomInset,
  role,
  cart,
  setCart,
  orderType,
  setOrderType,
  deliveryFee,
  setDeliveryFee,
  packagingFee,
  setPackagingFee,
}: {
  bottomInset: number;
  role: Role;
  cart: Cart;
  setCart: Dispatch<SetStateAction<Cart>>;
  orderType: "dine-in" | "takeaway";
  setOrderType: Dispatch<SetStateAction<"dine-in" | "takeaway">>;
  deliveryFee: string;
  setDeliveryFee: Dispatch<SetStateAction<string>>;
  packagingFee: string;
  setPackagingFee: Dispatch<SetStateAction<string>>;
}) {
  const createOrder = useMutation(api.orders.create);
  const addPayment = useMutation(api.orders.addPayment);
  const cancelOrder = useMutation(api.orders.cancel);
  const refundOrder = useMutation(api.orders.refund);
  const setSoldOut = useMutation(api.menu.setSoldOut);
  const unpaidOrders = useQuery(api.orders.unpaid);
  const recentOrders = useQuery(api.orders.recent);
  const liveMenu = useQuery(api.menu.list);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"unpaid" | "recent">("unpaid");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ number: string; totalKobo: number; changeKobo: number; method: PaymentMethod } | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<Doc<"orders"> | null>(null);
  const [cancelHandling, setCancelHandling] = useState<"return" | "waste">("return");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const paymentSummary = useQuery(api.orders.paymentSummary, pendingPayment ? { orderId: pendingPayment.orderId } : "skip");
  const [refundingOrder, setRefundingOrder] = useState<Doc<"orders"> | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const menuItems = liveMenu?.length ? liveMenu.map(toMenuItem) : fallbackMenuItems;
  const categories = ["All", ...Array.from(new Set(menuItems.map((item) => item.category)))];
  const visibleItems = menuItems.filter((item) => {
    const inCategory = category === "All" || item.category === category;
    const inSearch = item.name.toLowerCase().includes(search.trim().toLowerCase());
    return inCategory && inSearch;
  });
  const cartLines = Object.values(cart).filter((line) => line.quantity > 0);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const itemTotalKobo = cartLines.reduce((sum, line) => sum + line.item.priceKobo * line.quantity, 0);
  const deliveryFeeKobo = orderType === "takeaway" ? nairaInputToKobo(deliveryFee) : 0;
  const packagingFeeKobo = orderType === "takeaway" ? nairaInputToKobo(packagingFee) : 0;
  const totalKobo = itemTotalKobo + deliveryFeeKobo + packagingFeeKobo;
  const cashTenderedKobo = nairaInputToKobo(amountReceived);
  const remainingKobo = paymentSummary?.remainingKobo ?? pendingPayment?.totalKobo ?? 0;
  const cashChangeKobo = Math.max(0, cashTenderedKobo - remainingKobo);

  useEffect(() => {
    if (!paymentOpen || !paymentSummary || paymentMethod === "cash" || paymentAmount) return;
    setPaymentAmount(String(Math.ceil(paymentSummary.remainingKobo / 100)));
  }, [paymentAmount, paymentMethod, paymentOpen, paymentSummary]);

  const changeQuantity = (item: MenuItem, amount: number) => {
    setCart((current) => {
      const existing = current[item.key];
      const quantity = Math.max(0, (existing?.quantity ?? 0) + amount);
      if (quantity === 0) {
        const next = { ...current };
        delete next[item.key];
        return next;
      }
      return { ...current, [item.key]: { item, quantity } };
    });
  };

  const sendToKitchen = async () => {
    if (!cartLines.length || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const result = await createOrder({
        clientRequestId: `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        orderType,
        deliveryFeeKobo,
        packagingFeeKobo,
        items: cartLines.map(({ item, quantity }) => ({
          key: item.key,
          name: item.name,
          quantity,
          unitPriceKobo: item.priceKobo,
        })),
      });
      setCart({});
      setDeliveryFee("");
      setPackagingFee("");
      setCartOpen(false);
      setMessage(`${result.number} placed · ${itemCount} item${itemCount === 1 ? "" : "s"} sent to kitchen`);
      setPendingPayment({ orderId: result.orderId, number: result.number, totalKobo: result.totalKobo, itemCount });
      setPaymentMethod("cash");
      setAmountReceived("");
      setPaymentAmount("");
      setPaymentError(null);
      setPaymentNotice(null);
      setReceipt(null);
      setPaymentOpen(true);
    } catch (error) {
      const localBackend = process.env.EXPO_PUBLIC_CONVEX_URL?.includes("127.0.0.1");
      setMessage(localBackend ? "Cannot reach local Convex. Keep `npx convex dev` running and make sure the phone and Mac use the same Wi-Fi." : error instanceof Error ? error.message : "Could not place the order.");
    } finally {
      setSending(false);
    }
  };

  const openPayment = (order: PendingPayment) => {
    setHistoryOpen(false);
    setPendingPayment(order);
    setPaymentMethod("cash");
    setAmountReceived("");
    setPaymentAmount("");
    setPaymentError(null);
    setPaymentNotice(null);
    setReceipt(null);
    setPaymentOpen(true);
  };

  const completePayment = async () => {
    if (!pendingPayment || paying) return;
    const amountKobo = paymentMethod === "cash" ? remainingKobo : nairaInputToKobo(paymentAmount);
    const amountTenderedKobo = paymentMethod === "cash" ? nairaInputToKobo(amountReceived) : amountKobo;
    if (amountKobo <= 0) {
      setPaymentError("Enter a payment amount.");
      return;
    }
    if (paymentMethod === "cash" && amountTenderedKobo < amountKobo) {
      setPaymentError("Amount received is less than the balance.");
      return;
    }

    setPaying(true);
    setPaymentError(null);
    try {
      const result = await addPayment({
        orderId: pendingPayment.orderId,
        paymentMethod,
        amountKobo,
        amountTenderedKobo,
      });
      if (result.remainingKobo === 0) {
        setReceipt({ number: result.number, totalKobo: result.totalKobo, changeKobo: result.changeKobo, method: paymentMethod });
        setMessage(`${result.number} payment completed`);
      } else {
        setPaymentNotice(`${formatNaira(result.appliedKobo)} added · ${formatNaira(result.remainingKobo)} remaining`);
        setPaymentAmount("");
        setAmountReceived("");
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Could not complete payment.");
    } finally {
      setPaying(false);
    }
  };

  const openCancellation = (order: Doc<"orders">) => {
    setHistoryOpen(false);
    setCancellingOrder(order);
    setCancelHandling(order.status === "new" ? "return" : "waste");
    setCancelError(null);
  };

  const confirmCancellation = async () => {
    if (!cancellingOrder || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelOrder({ orderId: cancellingOrder._id, inventoryHandling: cancelHandling });
      setMessage(`${cancellingOrder.number} cancelled · ingredients ${cancelHandling === "return" ? "returned to stock" : "recorded as waste"}`);
      setCancellingOrder(null);
    } catch (cancelFailure) {
      setCancelError(cancelFailure instanceof Error ? cancelFailure.message : "Could not cancel this order.");
    } finally {
      setCancelling(false);
    }
  };

  const openRefund = (order: Doc<"orders">) => {
    setHistoryOpen(false);
    setRefundingOrder(order);
    setRefundAmount("");
    setRefundMethod(order.paymentMethod ?? "cash");
    setRefundReason("");
    setRefundError(null);
  };

  const confirmRefund = async () => {
    if (!refundingOrder || refunding) return;
    const amountKobo = nairaInputToKobo(refundAmount);
    if (amountKobo <= 0) {
      setRefundError("Enter a refund amount.");
      return;
    }
    setRefunding(true);
    setRefundError(null);
    try {
      const result = await refundOrder({ orderId: refundingOrder._id, amountKobo, method: refundMethod, reason: refundReason.trim() || undefined });
      setMessage(`${result.number} refund recorded · ${formatNaira(result.amountKobo)}`);
      setRefundingOrder(null);
    } catch (refundFailure) {
      setRefundError(refundFailure instanceof Error ? refundFailure.message : "Could not record the refund.");
    } finally {
      setRefunding(false);
    }
  };

  return (
    <View style={styles.posScreen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.posContent, { paddingBottom: itemCount ? 184 + bottomInset : 116 + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.posHeader}>
          <View style={styles.headerBrandRow}>
            <BrandMark size={28} />
            <Text style={styles.posTitle}>New sale</Text>
          </View>
          <Pressable style={styles.historyButton} accessibilityLabel="Open unpaid orders" onPress={() => setHistoryOpen(true)}>
            <Ionicons name="time-outline" size={22} color="#9E452B" />
            {!!unpaidOrders?.length && <View style={styles.historyBadge}><Text style={styles.historyBadgeText}>{unpaidOrders.length}</Text></View>}
          </Pressable>
        </View>

        {message && (
          <Pressable style={[styles.posMessage, message.startsWith("Could") && styles.posMessageError]} onPress={() => setMessage(null)}>
            <Ionicons name={message.startsWith("Could") ? "alert-circle" : "checkmark-circle"} size={19} color={message.startsWith("Could") ? "#A84F37" : "#426A48"} />
            <Text style={styles.posMessageText}>{message}</Text>
            <Ionicons name="close" size={17} color="#7A8078" />
          </Pressable>
        )}

        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#858A82" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search menu"
            placeholderTextColor="#9B9E98"
            style={styles.searchInput}
            returnKeyType="search"
          />
          {search.length > 0 && <Pressable onPress={() => setSearch("")}><Ionicons name="close-circle" size={19} color="#A7AAA4" /></Pressable>}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {categories.map((item) => {
            const active = item === category;
            return (
              <Pressable key={item} onPress={() => setCategory(item)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{item}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.menuHeading}>
          <Text style={styles.menuHeadingText}>{category === "All" ? "Popular today" : category}</Text>
          <Text style={styles.menuCount}>{visibleItems.length} items</Text>
        </View>

        <View style={styles.menuList}>
          {visibleItems.map((item) => {
            const quantity = cart[item.key]?.quantity ?? 0;
            return (
              <Pressable key={item.key} style={styles.menuRow} onPress={() => { if (!item.soldOut) changeQuantity(item, 1); }}>
                <View style={[styles.menuThumb, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={28} color="#6A5948" />
                </View>
                <View style={styles.menuCopy}>
                  <Text style={styles.menuName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.menuDescription} numberOfLines={1}>{item.description}</Text>
                  <Text style={styles.menuPrice}>{formatNaira(item.priceKobo)}</Text>
                </View>
                {item.soldOut
                  ? <Pressable style={styles.soldOutButton} onPress={() => { if (item.menuItemId) setSoldOut({ menuItemId: item.menuItemId, soldOut: false }); }}><Text style={styles.soldOutText}>SOLD OUT</Text></Pressable>
                  : <View style={[styles.addButton, quantity > 0 && styles.addButtonActive]}>
                      {quantity > 0 ? <Text style={styles.addButtonQuantity}>{quantity}</Text> : <Ionicons name="add" size={21} color="#704129" />}
                    </View>}
              </Pressable>
            );
          })}
        </View>

        {visibleItems.length === 0 && (
          <View style={styles.noResults}>
            <Ionicons name="search-outline" size={30} color="#A3A79F" />
            <Text style={styles.noResultsTitle}>No menu items found</Text>
            <Text style={styles.noResultsCopy}>Try another search or category.</Text>
          </View>
        )}
      </ScrollView>

      {itemCount > 0 && (
        <Pressable style={[styles.cartDock, { bottom: 76 + bottomInset }]} onPress={() => setCartOpen(true)}>
          <View style={styles.cartCount}><Text style={styles.cartCountText}>{itemCount}</Text></View>
          <View style={styles.cartDockCopy}>
            <Text style={styles.cartDockLabel}>View current order</Text>
            <Text style={styles.cartDockMeta}>{cartLines.length} menu {cartLines.length === 1 ? "item" : "items"}</Text>
          </View>
          <Text style={styles.cartDockTotal}>{formatNaira(totalKobo)}</Text>
          <Ionicons name="chevron-up" size={18} color="#D9E4D7" />
        </Pressable>
      )}

      <Modal visible={cartOpen} transparent animationType="slide" onRequestClose={() => setCartOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCartOpen(false)} />
          <View style={[styles.cartSheet, { paddingBottom: Math.max(bottomInset, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Current order</Text><Text style={styles.sheetSubtitle}>{itemCount} {itemCount === 1 ? "item" : "items"}</Text></View>
              <Pressable style={styles.sheetClose} onPress={() => setCartOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
            </View>

            <View style={styles.orderTypeControl}>
              <Pressable style={[styles.orderTypeOption, orderType === "dine-in" && styles.orderTypeActive]} onPress={() => setOrderType("dine-in")}>
                <Ionicons name="restaurant-outline" size={18} color={orderType === "dine-in" ? "#FFFFFF" : "#6E746D"} />
                <Text style={[styles.orderTypeText, orderType === "dine-in" && styles.orderTypeTextActive]}>Dine in</Text>
              </Pressable>
              <Pressable style={[styles.orderTypeOption, orderType === "takeaway" && styles.orderTypeActive]} onPress={() => setOrderType("takeaway")}>
                <Ionicons name="bag-handle-outline" size={18} color={orderType === "takeaway" ? "#FFFFFF" : "#6E746D"} />
                <Text style={[styles.orderTypeText, orderType === "takeaway" && styles.orderTypeTextActive]}>Takeaway</Text>
              </Pressable>
            </View>

            {orderType === "takeaway" && (
              <View style={styles.takeawayFees}>
                <View style={styles.feeField}>
                  <Text style={styles.feeLabel}>Delivery fee</Text>
                  <View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={deliveryFee} onChangeText={(value) => setDeliveryFee(cleanMoneyInput(value))} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View>
                </View>
                <View style={styles.feeField}>
                  <Text style={styles.feeLabel}>Takeout packs</Text>
                  <View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={packagingFee} onChangeText={(value) => setPackagingFee(cleanMoneyInput(value))} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View>
                </View>
              </View>
            )}

            <ScrollView style={styles.cartLines} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {cartLines.map(({ item, quantity }) => (
                <View key={item.key} style={styles.cartLine}>
                  <View style={[styles.cartLineIcon, { backgroundColor: item.color }]}><Ionicons name={item.icon} size={20} color="#686454" /></View>
                  <View style={styles.cartLineMain}>
                    <View style={styles.cartLineTop}>
                      <View style={styles.cartLineNameWrap}><Text style={styles.cartLineName}>{item.name}</Text><Text style={styles.cartLinePrice}>{formatNaira(item.priceKobo * quantity)}</Text></View>
                      <View style={styles.stepper}>
                        <Pressable style={styles.stepButton} onPress={() => changeQuantity(item, -1)}><Ionicons name={quantity === 1 ? "trash-outline" : "remove"} size={21} color={quantity === 1 ? "#B85B42" : "#465047"} /></Pressable>
                        <Text style={styles.stepValue}>{quantity}</Text>
                        <Pressable style={[styles.stepButton, styles.stepButtonAdd]} onPress={() => changeQuantity(item, 1)}><Ionicons name="add" size={22} color="#FFFFFF" /></Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.totalsBlock}>
              {orderType === "takeaway" && <><View style={styles.subtotalRow}><Text style={styles.subtotalLabel}>Items</Text><Text style={styles.subtotalValue}>{formatNaira(itemTotalKobo)}</Text></View><View style={styles.subtotalRow}><Text style={styles.subtotalLabel}>Delivery</Text><Text style={styles.subtotalValue}>{formatNaira(deliveryFeeKobo)}</Text></View><View style={styles.subtotalRow}><Text style={styles.subtotalLabel}>Takeout packs</Text><Text style={styles.subtotalValue}>{formatNaira(packagingFeeKobo)}</Text></View></>}
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{formatNaira(totalKobo)}</Text></View>
            </View>
            <Pressable style={[styles.sendButton, sending && styles.sendButtonDisabled]} onPress={sendToKitchen} disabled={sending}>
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Place order</Text><Ionicons name="arrow-forward" size={19} color="#FFFFFF" /></>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setHistoryOpen(false)} />
          <View style={[styles.historySheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Orders</Text>
                <Text style={styles.sheetSubtitle}>Payments, progress, and cancellations</Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={() => setHistoryOpen(false)}>
                <Ionicons name="close" size={21} color="#4D534D" />
              </Pressable>
            </View>

            <View style={styles.historyTabs}>
              <Pressable style={[styles.historyTab, historyTab === "unpaid" && styles.historyTabActive]} onPress={() => setHistoryTab("unpaid")}><Text style={[styles.historyTabText, historyTab === "unpaid" && styles.historyTabTextActive]}>Unpaid</Text>{!!unpaidOrders?.length && <View style={styles.historyTabBadge}><Text style={styles.historyTabBadgeText}>{unpaidOrders.length}</Text></View>}</Pressable>
              <Pressable style={[styles.historyTab, historyTab === "recent" && styles.historyTabActive]} onPress={() => setHistoryTab("recent")}><Text style={[styles.historyTabText, historyTab === "recent" && styles.historyTabTextActive]}>Recent</Text></Pressable>
            </View>

            {(historyTab === "unpaid" ? unpaidOrders : recentOrders) === undefined ? (
              <View style={styles.historyEmpty}>
                <ActivityIndicator color="#A84629" />
                <Text style={styles.historyEmptyCopy}>Loading orders…</Text>
              </View>
            ) : historyTab === "unpaid" && unpaidOrders?.length === 0 ? (
              <View style={styles.historyEmpty}>
                <View style={styles.historyEmptyIcon}><Ionicons name="checkmark" size={28} color="#4F7650" /></View>
                <Text style={styles.historyEmptyTitle}>Everything is paid</Text>
                <Text style={styles.historyEmptyCopy}>New unpaid orders will appear here.</Text>
              </View>
            ) : historyTab === "recent" && recentOrders?.length === 0 ? (
              <View style={styles.historyEmpty}>
                <View style={styles.historyEmptyIcon}><Ionicons name="receipt-outline" size={28} color="#4F7650" /></View>
                <Text style={styles.historyEmptyTitle}>No orders yet</Text>
                <Text style={styles.historyEmptyCopy}>Placed orders will appear here.</Text>
              </View>
            ) : (
              <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
                {(historyTab === "unpaid" ? unpaidOrders ?? [] : recentOrders ?? []).map((order) => {
                  const orderItemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
                  const canCancel = order.paymentStatus === "unpaid" && (order.status === "new" || order.status === "preparing" || order.status === "ready");
                  const statusLabel = formatOrderStatus(order.status);
                  return (
                    <View key={order._id} style={styles.orderHistoryRow}>
                      <View style={styles.orderHistoryTop}>
                        <View style={styles.unpaidIcon}><Ionicons name="receipt-outline" size={22} color="#9D482E" /></View>
                        <View style={styles.unpaidMain}>
                          <View style={styles.orderHistoryHeading}><Text style={styles.unpaidNumber}>{order.number}</Text><View style={[styles.orderStatusBadge, order.status === "cancelled" && styles.orderStatusCancelled, order.status === "ready" && styles.orderStatusReady]}><Text style={[styles.orderStatusBadgeText, order.status === "cancelled" && styles.orderStatusCancelledText, order.status === "ready" && styles.orderStatusReadyText]}>{statusLabel}</Text></View></View>
                          <Text style={styles.unpaidMeta}>{orderItemCount} {orderItemCount === 1 ? "item" : "items"} · {order.orderType === "takeaway" ? "Takeaway" : "Dine in"}</Text>
                        </View>
                        <View style={styles.unpaidRight}><Text style={styles.unpaidAmount}>{formatNaira(order.totalKobo)}</Text><Text style={[styles.orderPaymentState, order.paymentStatus === "paid" && styles.orderPaymentPaid]}>{order.paymentStatus === "paid" ? "Paid" : "Unpaid"}</Text></View>
                      </View>
                      <View style={styles.orderHistoryActions}>
                        {order.paymentStatus === "unpaid" && order.status !== "cancelled" && <Pressable style={styles.orderPayButton} onPress={() => openPayment({ orderId: order._id, number: order.number, totalKobo: order.totalKobo, itemCount: orderItemCount })}><Text style={styles.orderPayButtonText}>Take payment</Text></Pressable>}
                        {historyTab === "recent" && canCancel && <Pressable style={styles.orderCancelButton} onPress={() => openCancellation(order)}><Text style={styles.orderCancelButtonText}>Cancel order</Text></Pressable>}
                        {historyTab === "recent" && order.paymentStatus === "paid" && (role === "owner" || role === "manager") && <Pressable style={styles.orderRefundButton} onPress={() => openRefund(order)}><Text style={styles.orderRefundButtonText}>Refund</Text></Pressable>}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!cancellingOrder} transparent animationType="slide" onRequestClose={() => setCancellingOrder(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCancellingOrder(null)} />
          <View style={[styles.cancelSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Cancel {cancellingOrder?.number}</Text><Text style={styles.sheetSubtitle}>Choose what physically happened to the ingredients</Text></View>
              <Pressable style={styles.sheetClose} onPress={() => setCancellingOrder(null)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
            </View>

            <Pressable style={[styles.cancelChoice, cancelHandling === "return" && styles.cancelChoiceActive]} onPress={() => { setCancelHandling("return"); setCancelError(null); }}>
              <View style={[styles.cancelChoiceIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="return-up-back" size={24} color="#557451" /></View>
              <View style={styles.cancelChoiceMain}><Text style={styles.cancelChoiceTitle}>Return ingredients to stock</Text><Text style={styles.cancelChoiceCopy}>Use when cooking has not started and ingredients can still be used.</Text></View>
              <Ionicons name={cancelHandling === "return" ? "radio-button-on" : "radio-button-off"} size={23} color={cancelHandling === "return" ? "#A84629" : "#AAA39C"} />
            </Pressable>

            <Pressable style={[styles.cancelChoice, cancelHandling === "waste" && styles.cancelChoiceActive]} onPress={() => { setCancelHandling("waste"); setCancelError(null); }}>
              <View style={[styles.cancelChoiceIcon, { backgroundColor: "#F6E2DA" }]}><Ionicons name="trash-outline" size={24} color="#A54A32" /></View>
              <View style={styles.cancelChoiceMain}><Text style={styles.cancelChoiceTitle}>Record ingredients as waste</Text><Text style={styles.cancelChoiceCopy}>Use when preparation started and the ingredients cannot be reused.</Text></View>
              <Ionicons name={cancelHandling === "waste" ? "radio-button-on" : "radio-button-off"} size={23} color={cancelHandling === "waste" ? "#A84629" : "#AAA39C"} />
            </Pressable>

            {cancelError && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{cancelError}</Text></View>}
            <Pressable style={[styles.cancelConfirmButton, cancelling && styles.sendButtonDisabled]} onPress={confirmCancellation} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Cancel order</Text><Ionicons name="close-circle-outline" size={20} color="#FFFFFF" /></>}
            </Pressable>
            <Pressable style={styles.payLaterButton} onPress={() => setCancellingOrder(null)} disabled={cancelling}><Text style={styles.payLaterText}>Keep order</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!refundingOrder} transparent animationType="slide" onRequestClose={() => setRefundingOrder(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRefundingOrder(null)} />
          <View style={[styles.refundSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Refund {refundingOrder?.number}</Text><Text style={styles.sheetSubtitle}>The refund will be recorded in Money.</Text></View>
              <Pressable style={styles.sheetClose} onPress={() => setRefundingOrder(null)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
            </View>
            <View style={styles.refundWarning}><Ionicons name="information-circle-outline" size={21} color="#9A6B29" /><Text style={styles.refundWarningText}>Refund only what the customer actually paid. Partial refunds are supported.</Text></View>
            <Text style={styles.receiveLabel}>How is the refund paid?</Text>
            <View style={styles.moreTabs}>{(["cash", "card", "transfer"] as const).map((item) => <Pressable key={item} style={[styles.moreTab, refundMethod === item && styles.moreTabActive]} onPress={() => setRefundMethod(item)}><Text style={[styles.moreTabText, refundMethod === item && styles.moreTabTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
            <Text style={styles.receiveLabel}>Refund amount</Text>
            <View style={styles.cashInputWrap}><Text style={styles.cashPrefix}>₦</Text><TextInput value={refundAmount} onChangeText={(value) => { setRefundAmount(cleanMoneyInput(value)); setRefundError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.cashInput} autoFocus /></View>
            <Text style={styles.receiveLabel}>Reason (optional)</Text>
            <View style={styles.reasonInputWrap}><TextInput value={refundReason} onChangeText={setRefundReason} placeholder="e.g. Missing item" placeholderTextColor="#A0A49D" style={styles.reasonInput} maxLength={120} /></View>
            {refundError && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{refundError}</Text></View>}
            <Pressable style={[styles.refundConfirmButton, refunding && styles.sendButtonDisabled]} onPress={confirmRefund} disabled={refunding}>
              {refunding ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Record refund</Text><Ionicons name="return-up-back" size={20} color="#FFFFFF" /></>}
            </Pressable>
            <Pressable style={styles.payLaterButton} onPress={() => setRefundingOrder(null)} disabled={refunding}><Text style={styles.payLaterText}>Keep payment</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPaymentOpen(false)} />
          <View style={[styles.paymentSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            {receipt ? (
              <View style={styles.receiptContent}>
                <View style={styles.receiptIcon}><Ionicons name="checkmark" size={34} color="#FFFFFF" /></View>
                <Text style={styles.receiptTitle}>Payment complete</Text>
                <Text style={styles.receiptSubtitle}>{receipt.number} has been paid successfully.</Text>
                <View style={styles.receiptCard}>
                  <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Total paid</Text><Text style={styles.receiptValue}>{formatNaira(receipt.totalKobo)}</Text></View>
                  <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Payment method</Text><Text style={styles.receiptValue}>{formatPaymentMethod(receipt.method)}</Text></View>
                  {receipt.method === "cash" && <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Change</Text><Text style={[styles.receiptValue, styles.changeValue]}>{formatNaira(receipt.changeKobo)}</Text></View>}
                </View>
                <Pressable
                  style={styles.sendButton}
                  onPress={() => {
                    setPaymentOpen(false);
                    setPendingPayment(null);
                    setReceipt(null);
                  }}
                >
                  <Text style={styles.sendButtonText}>Done</Text>
                </Pressable>
              </View>
            ) : pendingPayment ? (
              <>
                <View style={styles.sheetHeader}>
                  <View><Text style={styles.sheetTitle}>Take payment</Text><Text style={styles.sheetSubtitle}>{pendingPayment.number} · {pendingPayment.itemCount} {pendingPayment.itemCount === 1 ? "item" : "items"}</Text></View>
                  <Pressable style={styles.sheetClose} onPress={() => setPaymentOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
                </View>

                <View style={styles.paymentHero}>
                  <Text style={styles.paymentTotalLabel}>AMOUNT DUE</Text>
                  <Text style={styles.paymentTotal}>{formatNaira(remainingKobo)}</Text>
                  {paymentSummary && paymentSummary.paidKobo > 0 && <Text style={styles.paymentPaidHint}>{formatNaira(paymentSummary.paidKobo)} already paid</Text>}
                </View>

                <Text style={styles.paymentSectionLabel}>Payment method</Text>
                <View style={styles.methodRow}>
                  {(["cash", "card", "transfer"] as PaymentMethod[]).map((method) => {
                    const active = paymentMethod === method;
                    const icon: IconName = method === "cash" ? "cash-outline" : method === "card" ? "card-outline" : "swap-horizontal-outline";
                    return (
                      <Pressable
                        key={method}
                        style={[styles.methodOption, active && styles.methodOptionActive]}
                        onPress={() => {
                          setPaymentMethod(method);
                          setPaymentAmount("");
                          setPaymentError(null);
                          setPaymentNotice(null);
                        }}
                      >
                        <Ionicons name={icon} size={21} color={active ? "#FFFFFF" : "#765F52"} />
                        <Text style={[styles.methodText, active && styles.methodTextActive]}>{formatPaymentMethod(method)}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {paymentMethod === "cash" ? (
                  <View style={styles.cashBlock}>
                    <Text style={styles.paymentSectionLabel}>Cash received</Text>
                    <View style={styles.cashInputWrap}>
                      <Text style={styles.cashPrefix}>₦</Text>
                      <TextInput
                        value={amountReceived}
                        onChangeText={(value) => {
                          setAmountReceived(cleanMoneyInput(value));
                          setPaymentError(null);
                        }}
                        placeholder="0"
                        placeholderTextColor="#A0A49D"
                        keyboardType="number-pad"
                        style={styles.cashInput}
                        autoFocus
                      />
                    </View>
                    <View style={styles.changeRow}>
                      <Text style={styles.changeLabel}>Change to customer</Text>
                      <Text style={styles.changeAmount}>{formatNaira(cashChangeKobo)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.cashBlock}>
                    <Text style={styles.paymentSectionLabel}>Amount to apply</Text>
                    <View style={styles.cashInputWrap}>
                      <Text style={styles.cashPrefix}>₦</Text>
                      <TextInput value={paymentAmount} onChangeText={(value) => { setPaymentAmount(cleanMoneyInput(value)); setPaymentError(null); setPaymentNotice(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.cashInput} />
                    </View>
                    <Text style={styles.splitHint}>You can add another payment method if a balance remains.</Text>
                  </View>
                )}

                {paymentError && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{paymentError}</Text></View>}
                {paymentNotice && <View style={styles.paymentNoticeBox}><Ionicons name="checkmark-circle" size={18} color="#4D7651" /><Text style={styles.paymentNoticeText}>{paymentNotice}</Text></View>}

                <Pressable style={[styles.sendButton, paying && styles.sendButtonDisabled]} onPress={completePayment} disabled={paying}>
                  {paying ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Complete payment</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}
                </Pressable>
                <Pressable style={styles.payLaterButton} onPress={() => setPaymentOpen(false)} disabled={paying}>
                  <Text style={styles.payLaterText}>Pay later</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function formatNaira(kobo: number) {
  return `₦${Math.round(kobo / 100).toLocaleString("en-NG")}`;
}

function formatCashDifference(differenceKobo: number) {
  if (differenceKobo === 0) return "Balanced";
  return `${formatNaira(Math.abs(differenceKobo))} ${differenceKobo < 0 ? "short" : "over"}`;
}

function roleLabel(role: Role) {
  return ({ owner: "Owner", manager: "Manager", cashier: "Cashier", kitchen: "Kitchen" })[role];
}

function roleDescription(role: Role) {
  return ({
    owner: "Full access to sales, stock, money and menu setup.",
    manager: "Sales, kitchen, stock and money operations.",
    cashier: "Take orders, manage payments and follow kitchen progress.",
    kitchen: "View incoming orders and update kitchen progress.",
  })[role];
}

function cleanMoneyInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 8);
}

function nairaInputToKobo(value: string) {
  return (Number.parseInt(value || "0", 10) || 0) * 100;
}

function formatPaymentMethod(method: PaymentMethod) {
  return method === "cash" ? "Cash" : method === "card" ? "Card" : "Transfer";
}

function formatOrderStatus(status: Doc<"orders">["status"]) {
  if (status === "new") return "New";
  if (status === "preparing") return "Preparing";
  if (status === "ready") return "Ready";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Paid";
}

function toMenuItem(item: Doc<"menuItems">): MenuItem {
  const icon = item.icon && item.icon in Ionicons.glyphMap ? item.icon as IconName : "restaurant-outline";
  return {
    key: item.key ?? item._id,
    name: item.name,
    description: item.description ?? "Freshly prepared",
    priceKobo: item.priceKobo,
    category: item.category,
    icon,
    color: item.color ?? "#EFE3D8",
    soldOut: item.soldOut === true,
    menuItemId: item._id,
  };
}

function StockScreen({ bottomInset }: { bottomInset: number }) {
  const ingredients = useQuery(api.inventory.listIngredients);
  const recentMovements = useQuery(api.inventory.recentMovements);
  const receiveStock = useMutation(api.inventory.receiveStock);
  const recordWaste = useMutation(api.inventory.recordWaste);
  const adjustStock = useMutation(api.inventory.adjustStock);
  const createIngredient = useMutation(api.inventory.createIngredient);
  const updateIngredient = useMutation(api.inventory.updateIngredient);
  const deleteIngredient = useMutation(api.inventory.deleteIngredient);
  const [search, setSearch] = useState("");
  const [selectedIngredient, setSelectedIngredient] = useState<Doc<"ingredients"> | null>(null);
  const [receiveQuantity, setReceiveQuantity] = useState("");
  const [stockAction, setStockAction] = useState<StockAction>("receive");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockPeriod, setStockPeriod] = useState<"today" | "week" | "month">("today");
  const stockBounds = stockPeriod === "today" ? getTodayBounds() : getRangeBounds(stockPeriod === "week" ? 7 : 30);
  const stockReport = useQuery(api.inventory.stockReport, stockBounds);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIngredientId, setEditingIngredientId] = useState<Id<"ingredients"> | null>(null);
  const [formName, setFormName] = useState("");
  const [formUnit, setFormUnit] = useState("kg");
  const [formLowStock, setFormLowStock] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formConfirmDelete, setFormConfirmDelete] = useState(false);

  const visibleIngredients = (ingredients ?? []).filter((ingredient) => ingredient.name.toLowerCase().includes(search.trim().toLowerCase()));
  const lowCount = ingredients?.filter((ingredient) => ingredient.quantity <= ingredient.lowStockLevel).length ?? 0;

  const saveStockChange = async () => {
    if (!selectedIngredient || saving) return;
    const quantity = Number.parseFloat(receiveQuantity);
    if (!Number.isFinite(quantity) || (stockAction !== "adjust" && quantity <= 0)) {
      setError(stockAction === "adjust" ? "Enter a valid counted quantity." : "Enter a quantity greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (stockAction === "receive") await receiveStock({ ingredientId: selectedIngredient._id, quantity });
      else if (stockAction === "waste") await recordWaste({ ingredientId: selectedIngredient._id, quantity });
      else await adjustStock({ ingredientId: selectedIngredient._id, quantity });
      setSelectedIngredient(null);
      setReceiveQuantity("");
    } catch (receiveError) {
      setError(receiveError instanceof Error ? receiveError.message : "Could not update stock.");
    } finally {
      setSaving(false);
    }
  };

  const openCreateIngredient = () => {
    setSelectedIngredient(null); setEditingIngredientId(null); setFormName(""); setFormUnit("kg"); setFormLowStock(""); setFormCost(""); setFormQuantity(""); setFormActive(true); setFormConfirmDelete(false); setFormError(null); setFormOpen(true);
  };
  const openEditIngredient = (ingredient: Doc<"ingredients">) => {
    setSelectedIngredient(null); setEditingIngredientId(ingredient._id); setFormName(ingredient.name); setFormUnit(ingredient.unit); setFormLowStock(formatQuantity(ingredient.lowStockLevel)); setFormCost(String(Math.round((ingredient.costPerUnitKobo ?? 0) / 100))); setFormQuantity(""); setFormActive(ingredient.active !== false); setFormConfirmDelete(false); setFormError(null); setFormOpen(true);
  };
  const saveIngredientForm = async () => {
    if (!formName.trim() || !formUnit.trim()) { setFormError("Add a name and a unit."); return; }
    const lowStockLevel = Number.parseFloat(formLowStock || "0");
    const costPerUnitKobo = nairaInputToKobo(formCost || "0");
    if (!Number.isFinite(lowStockLevel) || lowStockLevel < 0 || costPerUnitKobo < 0) { setFormError("Enter valid low-stock and cost values."); return; }
    setFormSaving(true); setFormError(null);
    try {
      if (editingIngredientId) {
        await updateIngredient({ ingredientId: editingIngredientId, name: formName, unit: formUnit, lowStockLevel, costPerUnitKobo, active: formActive });
      } else {
        const quantity = Number.parseFloat(formQuantity || "0");
        if (!Number.isFinite(quantity)) { setFormError("Enter a valid opening quantity."); setFormSaving(false); return; }
        await createIngredient({ name: formName, unit: formUnit, quantity, lowStockLevel, costPerUnitKobo });
      }
      setFormOpen(false);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Could not save the ingredient.");
    } finally {
      setFormSaving(false);
    }
  };
  const deleteIngredientNow = async () => {
    if (!editingIngredientId) return;
    setFormSaving(true); setFormError(null);
    try {
      await deleteIngredient({ ingredientId: editingIngredientId });
      setFormOpen(false); setSelectedIngredient(null);
    } catch (deleteError) {
      setFormError(deleteError instanceof Error ? deleteError.message : "Could not delete the ingredient.");
      setFormConfirmDelete(false);
    } finally {
      setFormSaving(false);
    }
  };

  return (
    <View style={styles.stockScreen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.stockContent, { paddingBottom: 112 + bottomInset }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.stockHeader}>
          <View style={styles.headerBrandRow}><BrandMark size={28} /><Text style={styles.stockTitle}>Kitchen stock</Text></View>
          <View style={styles.stockCountPill}><Text style={styles.stockCountValue}>{ingredients?.length ?? 0}</Text><Text style={styles.stockCountLabel}>items</Text></View>
        </View>

        <View style={styles.stockOverview}>
          <View style={styles.stockOverviewIcon}><Ionicons name="cube" size={25} color="#FFFFFF" /></View>
          <View style={styles.stockOverviewCopy}><Text style={styles.stockOverviewTitle}>{lowCount ? `${lowCount} item${lowCount === 1 ? "" : "s"} need attention` : "Stock levels look good"}</Text><Text style={styles.stockOverviewText}>{lowCount ? "Receive stock before service runs out." : "No ingredients are below their low-stock level."}</Text></View>
        </View>

        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Stock report</Text><Text style={styles.moreSectionHint}>Value and usage</Text></View>
        <View style={styles.reportPeriodRow}>{(["today", "week", "month"] as const).map((period) => <Pressable key={period} style={[styles.reportPeriodChip, stockPeriod === period && styles.reportPeriodChipActive]} onPress={() => setStockPeriod(period)}><Text style={[styles.reportPeriodText, stockPeriod === period && styles.reportPeriodTextActive]}>{period === "today" ? "Today" : period === "week" ? "7 days" : "30 days"}</Text></Pressable>)}</View>
        <View style={styles.reportCard}>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Stock value</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(stockReport?.stockValueKobo ?? 0)}</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Low stock</Text><Text style={[styles.shiftBreakdownValue, { color: (stockReport?.lowStockCount ?? 0) > 0 ? "#A34A30" : "#557451" }]}>{stockReport?.lowStockCount ?? 0} items</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Negative stock</Text><Text style={[styles.shiftBreakdownValue, { color: (stockReport?.negativeStockCount ?? 0) > 0 ? "#A34A30" : "#557451" }]}>{stockReport?.negativeStockCount ?? 0} items</Text></View>
          <View style={[styles.shiftBreakdownRow, styles.shiftBreakdownTotalRow]}><Text style={styles.shiftBreakdownTotalLabel}>Waste value</Text><Text style={styles.shiftBreakdownTotalValue}>{formatNaira(stockReport?.wasteValueKobo ?? 0)}</Text></View>
        </View>
        {stockReport?.mostUsed.length ? <View style={styles.groupedList}>{stockReport.mostUsed.map((item, index) => <View key={item.name} style={[styles.attentionItem, index < stockReport.mostUsed.length - 1 && styles.divider]}><View style={styles.rankBadge}><Text style={styles.rankText}>{index + 1}</Text></View><View style={styles.attentionCopy}><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.itemMeta}>Most used in this period</Text></View><Text style={styles.rankQty}>{formatQuantity(item.quantity)} {item.unit}</Text></View>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No kitchen usage in this period.</Text></View>}

        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#858A82" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search ingredients" placeholderTextColor="#9B9E98" style={styles.searchInput} returnKeyType="search" />
          {search.length > 0 && <Pressable onPress={() => setSearch("")}><Ionicons name="close-circle" size={19} color="#A7AAA4" /></Pressable>}
        </View>

        <View style={styles.stockListHeader}><Text style={styles.stockListTitle}>Ingredients</Text><Pressable style={styles.stockAddButton} onPress={openCreateIngredient}><Ionicons name="add" size={16} color="#557451" /><Text style={styles.stockAddText}>New</Text></Pressable></View>

        {ingredients === undefined ? (
          <View style={styles.stockEmpty}><ActivityIndicator size="large" color="#A84629" /><Text style={styles.stockEmptyTitle}>Loading stock…</Text></View>
        ) : visibleIngredients.length === 0 ? (
          <View style={styles.stockEmpty}><View style={styles.kitchenEmptyIcon}><Ionicons name="cube-outline" size={32} color="#678064" /></View><Text style={styles.stockEmptyTitle}>No ingredients found</Text><Text style={styles.stockEmptyCopy}>Try another search.</Text></View>
        ) : (
          <View style={styles.stockList}>
            {visibleIngredients.map((ingredient) => {
              const low = ingredient.quantity <= ingredient.lowStockLevel;
              return (
                <Pressable
                  key={ingredient._id}
                  style={styles.stockRow}
                  onPress={() => {
                    setSelectedIngredient(ingredient);
                    setReceiveQuantity("");
                    setStockAction("receive");
                    setError(null);
                  }}
                >
                  <View style={[styles.stockItemIcon, low && styles.stockItemIconLow]}><Ionicons name={low ? "alert-circle-outline" : "leaf-outline"} size={23} color={low ? "#A74A31" : "#5D7858"} /></View>
                  <View style={styles.stockItemMain}>
                    <View style={styles.stockItemHeading}><Text style={styles.stockItemName}>{ingredient.name}</Text>{ingredient.active === false && <View style={styles.inactiveBadge}><Text style={styles.inactiveBadgeText}>Inactive</Text></View>}{low && <View style={styles.lowBadge}><Text style={styles.lowBadgeText}>Low</Text></View>}</View>
                    <Text style={styles.stockItemMeta}>Alert at {formatQuantity(ingredient.lowStockLevel)} {ingredient.unit}</Text>
                  </View>
                  <View style={styles.stockQuantityBlock}><Text style={[styles.stockQuantity, low && styles.stockQuantityLow]}>{formatQuantity(ingredient.quantity)}</Text><Text style={styles.stockUnit}>{ingredient.unit}</Text></View>
                  <Ionicons name="chevron-forward" size={18} color="#B0AAA4" />
                </Pressable>
              );
            })}
          </View>
        )}

        {!!recentMovements?.length && (
          <View style={styles.movementSection}>
            <View style={styles.stockListHeader}><Text style={styles.stockListTitle}>Recent movement</Text><Text style={styles.stockListHint}>Live history</Text></View>
            <View style={styles.movementList}>
              {recentMovements.slice(0, 8).map((movement, index) => {
                const positive = movement.quantityDelta >= 0;
                const label = movement.type === "sale" ? "Used in sale" : movement.type === "receive" ? "Stock received" : movement.type === "waste" ? "Waste" : movement.type === "cancellation" ? "Order cancelled" : "Stock adjusted";
                return (
                  <View key={movement._id} style={[styles.movementRow, index < Math.min(recentMovements.length, 8) - 1 && styles.divider]}>
                    <View style={[styles.movementIcon, positive ? styles.movementIconPositive : styles.movementIconNegative]}><Ionicons name={positive ? "arrow-down" : "arrow-up"} size={17} color={positive ? "#50734F" : "#A64A31"} /></View>
                    <View style={styles.movementMain}><Text style={styles.movementName}>{movement.ingredient?.name ?? "Ingredient"}</Text><Text style={styles.movementMeta}>{label}</Text></View>
                    <View style={styles.movementAmountWrap}><Text style={[styles.movementAmount, positive ? styles.movementAmountPositive : styles.movementAmountNegative]}>{positive ? "+" : ""}{formatQuantity(movement.quantityDelta)}</Text><Text style={styles.movementUnit}>{movement.ingredient?.unit ?? ""}</Text></View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selectedIngredient} transparent animationType="slide" onRequestClose={() => setSelectedIngredient(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedIngredient(null)} />
          <View style={[styles.receiveSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Update stock</Text><Text style={styles.sheetSubtitle}>{selectedIngredient?.name}</Text></View>
              <View style={styles.sheetHeaderActions}><Pressable style={styles.sheetEditButton} onPress={() => selectedIngredient && openEditIngredient(selectedIngredient)} hitSlop={8}><Ionicons name="create-outline" size={16} color="#557451" /><Text style={styles.sheetEditText}>Edit</Text></Pressable><Pressable style={styles.sheetClose} onPress={() => setSelectedIngredient(null)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View>
            </View>
            <View style={styles.currentStockCard}>
              <Text style={styles.currentStockLabel}>CURRENT QUANTITY</Text>
              <Text style={styles.currentStockValue}>{selectedIngredient ? formatQuantity(selectedIngredient.quantity) : "0"} <Text style={styles.currentStockUnit}>{selectedIngredient?.unit}</Text></Text>
            </View>
            <View style={styles.stockActionTabs}>
              {(["receive", "waste", "adjust"] as StockAction[]).map((action) => {
                const active = action === stockAction;
                return <Pressable key={action} style={[styles.stockActionTab, active && styles.stockActionTabActive]} onPress={() => { setStockAction(action); setReceiveQuantity(""); setError(null); }}><Text style={[styles.stockActionTabText, active && styles.stockActionTabTextActive]}>{action === "receive" ? "Receive" : action === "waste" ? "Waste" : "Count"}</Text></Pressable>;
              })}
            </View>
            <Text style={styles.receiveLabel}>{stockAction === "receive" ? "Quantity received" : stockAction === "waste" ? "Quantity wasted" : "New counted quantity"}</Text>
            <View style={styles.receiveInputWrap}>
              <TextInput value={receiveQuantity} onChangeText={(value) => { setReceiveQuantity(cleanDecimalInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.receiveInput} autoFocus />
              <Text style={styles.receiveUnit}>{selectedIngredient?.unit}</Text>
            </View>
            {error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}
            <Pressable style={[styles.sendButton, stockAction === "waste" && styles.wasteButton, saving && styles.sendButtonDisabled]} onPress={saveStockChange} disabled={saving}>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFormOpen(false)} />
          <View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>{editingIngredientId ? "Edit ingredient" : "New ingredient"}</Text><Text style={styles.sheetSubtitle}>{editingIngredientId ? "Update how this ingredient is tracked" : "Add something you buy and use"}</Text></View>
              <Pressable style={styles.sheetClose} onPress={() => setFormOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
            </View>
            <ScrollView style={styles.moneySheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.receiveLabel}>Name</Text>
              <View style={styles.reasonInputWrap}><TextInput value={formName} onChangeText={(value) => { setFormName(value); setFormError(null); }} placeholder="e.g. Tomatoes" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View>
              <View style={styles.purchaseFieldRow}>
                <View style={styles.feeField}><Text style={styles.receiveLabel}>Unit</Text><View style={styles.reasonInputWrap}><TextInput value={formUnit} onChangeText={(value) => { setFormUnit(value); setFormError(null); }} placeholder="kg" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View></View>
                <View style={styles.feeField}><Text style={styles.receiveLabel}>Low-stock level</Text><View style={styles.moneyInputWrap}><TextInput value={formLowStock} onChangeText={(value) => { setFormLowStock(cleanDecimalInput(value)); setFormError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{formUnit}</Text></View></View>
              </View>
              <View style={styles.purchaseFieldRow}>
                <View style={styles.feeField}><Text style={styles.receiveLabel}>Unit cost</Text><View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={formCost} onChangeText={(value) => { setFormCost(cleanMoneyInput(value)); setFormError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View></View>
                {!editingIngredientId && <View style={styles.feeField}><Text style={styles.receiveLabel}>Opening quantity</Text><View style={styles.moneyInputWrap}><TextInput value={formQuantity} onChangeText={(value) => { setFormQuantity(cleanDecimalInput(value)); setFormError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{formUnit}</Text></View></View>}
              </View>
              {editingIngredientId && <Pressable style={styles.availabilityToggle} onPress={() => setFormActive(!formActive)}><Ionicons name={formActive ? "checkmark-circle" : "close-circle"} size={22} color={formActive ? "#557451" : "#A34A30"} /><Text style={styles.availabilityText}>{formActive ? "Available in menus and purchases" : "Inactive — hidden from new use"}</Text></Pressable>}
              {formError && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{formError}</Text></View>}
              <Pressable style={[styles.sendButton, formSaving && styles.sendButtonDisabled]} onPress={saveIngredientForm} disabled={formSaving}>
                {formSaving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>{editingIngredientId ? "Save changes" : "Add ingredient"}</Text><Ionicons name={editingIngredientId ? "checkmark" : "add"} size={21} color="#FFFFFF" /></>}
              </Pressable>
              {editingIngredientId && (formConfirmDelete ? <View style={styles.detailActionRow}><Pressable style={styles.detailCancelButton} onPress={() => { setFormConfirmDelete(false); setFormError(null); }}><Text style={styles.detailCancelText}>Keep it</Text></Pressable><Pressable style={[styles.detailRemoveButton, formSaving && styles.sendButtonDisabled]} onPress={deleteIngredientNow} disabled={formSaving}>{formSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.detailRemoveText}>Delete ingredient</Text>}</Pressable></View> : <Pressable style={styles.removePurchaseLink} onPress={() => { setFormError(null); setFormConfirmDelete(true); }}><Ionicons name="trash-outline" size={17} color="#A34A30" /><Text style={styles.removePurchaseText}>Delete ingredient</Text></Pressable>)}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function cleanDecimalInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole, ...decimals] = cleaned.split(".");
  return decimals.length ? `${whole}.${decimals.join("").slice(0, 2)}` : whole.slice(0, 8);
}

function BrandMark({ size = 28 }: { size?: number }) {
  return <Image source={require("../assets/logo.png")} style={{ width: size, height: size * 1.094, resizeMode: "contain" }} />;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function MoreScreen({ bottomInset, role, onSignOut }: { bottomInset: number; role: Role; onSignOut: () => void }) {
  const canSeeMoney = role === "owner" || role === "manager";
  const canManageMenu = role === "owner";
  const ingredients = useQuery(api.inventory.listIngredients, canSeeMoney ? {} : "skip");
  const recentExpenses = useQuery(api.money.recentExpenses, canSeeMoney ? {} : "skip");
  const recentPurchases = useQuery(api.money.recentPurchases, canSeeMoney ? {} : "skip");
  const currentShift = useQuery(api.shifts.current, role === "kitchen" ? "skip" : {});
  const closedShifts = useQuery(api.shifts.recentClosed, canSeeMoney ? {} : "skip");
  const todayBounds = getTodayBounds();
  const moneySummary = useQuery(api.money.summary, canSeeMoney ? todayBounds : "skip");
  const supplierSummary = useQuery(api.money.purchasesBySupplier, canSeeMoney ? todayBounds : "skip");
  const [reportPeriod, setReportPeriod] = useState<"today" | "week" | "month">("today");
  const reportBounds = reportPeriod === "today" ? todayBounds : getRangeBounds(reportPeriod === "week" ? 7 : 30);
  const reportSales = useQuery(api.reports.salesReport, canSeeMoney ? reportBounds : "skip");
  const reportPayments = useQuery(api.reports.paymentReport, canSeeMoney ? reportBounds : "skip");
  const reportTop = useQuery(api.reports.topItems, canSeeMoney ? { ...reportBounds, limit: 5 } : "skip");
  const addExpense = useMutation(api.money.addExpense);
  const receivePurchase = useMutation(api.money.receivePurchase);
  const addPurchaseItems = useMutation(api.money.addPurchaseItems);
  const removePurchase = useMutation(api.money.removePurchase);
  const removePurchaseItem = useMutation(api.money.removePurchaseItem);
  const updatePurchaseItem = useMutation(api.money.updatePurchaseItem);
  const updateMenuItem = useMutation(api.menu.updateItem);
  const createMenuItem = useMutation(api.menu.createItem);
  const createMenuCategory = useMutation(api.menu.createCategory);
  const renameMenuCategory = useMutation(api.menu.renameCategory);
  const upsertRecipe = useMutation(api.recipes.upsert);
  const removeRecipe = useMutation(api.recipes.remove);
  const createStaff = useMutation(api.team.createStaff);
  const staffList = useQuery(api.team.listStaff, role === "owner" ? {} : "skip");
  const setStaffActive = useMutation(api.team.setStaffActive);
  const changePin = useMutation(api.team.changePin);
  const resetStaffPin = useMutation(api.team.resetStaffPin);
  const resetAllData = useMutation(api.admin.resetAllData);
  const liveMenu = useQuery(api.menu.manageItems, canManageMenu ? {} : "skip");
  const menuCategories = useQuery(api.menu.manageCategories, canManageMenu ? {} : "skip");
  const startShift = useMutation(api.shifts.open);
  const endShift = useMutation(api.shifts.close);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [expenseMethod, setExpenseMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [purchaseMethod, setPurchaseMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [description, setDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchaseIngredientId, setPurchaseIngredientId] = useState<Id<"ingredients"> | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [purchaseLines, setPurchaseLines] = useState<{ ingredientId: Id<"ingredients">; quantity: number; unitCostKobo: number }[]>([]);
  const [purchaseDetailId, setPurchaseDetailId] = useState<Id<"purchases"> | null>(null);
  const [detailIngredientId, setDetailIngredientId] = useState<Id<"ingredients"> | null>(null);
  const [detailQuantity, setDetailQuantity] = useState("");
  const [detailUnitCost, setDetailUnitCost] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailConfirmRemove, setDetailConfirmRemove] = useState(false);
  const [editingLineId, setEditingLineId] = useState<Id<"purchaseItems"> | null>(null);
  const [editLineQuantity, setEditLineQuantity] = useState("");
  const [editLineUnitCost, setEditLineUnitCost] = useState("");
  const [confirmLineId, setConfirmLineId] = useState<Id<"purchaseItems"> | null>(null);
  const [lineSaving, setLineSaving] = useState(false);
  const purchaseDetail = useQuery(api.money.purchaseLines, purchaseDetailId ? { purchaseId: purchaseDetailId } : "skip");
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftMode, setShiftMode] = useState<"open" | "close">("open");
  const [shiftCash, setShiftCash] = useState("");
  const [shiftNote, setShiftNote] = useState("");
  const [shiftReportId, setShiftReportId] = useState<Id<"shifts"> | null>(null);
  const shiftReport = useQuery(api.shifts.report, shiftReportId ? { shiftId: shiftReportId } : "skip");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetReseed, setResetReseed] = useState(true);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [creatingMenuItem, setCreatingMenuItem] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryDraftName, setCategoryDraftName] = useState("");
  const [editingCategory, setEditingCategory] = useState<Doc<"menuCategories"> | null>(null);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<Doc<"menuItems"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editSoldOut, setEditSoldOut] = useState(false);
  const [recipeIngredientId, setRecipeIngredientId] = useState<Id<"ingredients"> | null>(null);
  const [recipeQuantity, setRecipeQuantity] = useState("");
  const recipeRows = useQuery(api.recipes.byMenuItem, editingMenuItem && canManageMenu ? { menuItemId: editingMenuItem._id } : "skip");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreSection, setMoreSection] = useState<"overview" | "money" | "setup">("overview");
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinMode, setPinMode] = useState<"change" | "reset">("change");
  const [pinTarget, setPinTarget] = useState<{ _id: Id<"users">; name?: string } | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffPhone, setStaffPhone] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [staffRole, setStaffRole] = useState<Exclude<Role, "owner">>("cashier");
  const sections = canManageMenu ? (["overview", "money", "setup"] as const) : canSeeMoney ? (["overview", "money"] as const) : (["overview"] as const);

  useEffect(() => {
    if (!sections.includes(moreSection as never)) setMoreSection("overview");
  }, [role]);

  const selectedPurchaseIngredient = ingredients?.find((ingredient) => ingredient._id === purchaseIngredientId) ?? ingredients?.[0];
  const detailIngredient = ingredients?.find((ingredient) => ingredient._id === detailIngredientId) ?? ingredients?.[0];
  const saveExpense = async () => {
    const amountKobo = nairaInputToKobo(expenseAmount);
    if (!description.trim() || amountKobo <= 0) { setError("Add a description and amount."); return; }
    setSaving(true); setError(null);
    try { await addExpense({ description, amountKobo, paymentMethod: expenseMethod }); setExpenseOpen(false); setDescription(""); setExpenseAmount(""); setExpenseMethod("cash"); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save expense."); } finally { setSaving(false); }
  };
  const addPurchaseLine = () => {
    if (!selectedPurchaseIngredient) { setError("Add ingredients first in Stock."); return; }
    const quantity = Number.parseFloat(purchaseQuantity);
    const unitCostKobo = nairaInputToKobo(unitCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitCostKobo < 0) { setError("Enter a valid quantity and unit cost."); return; }
    setPurchaseLines((current) => [...current, { ingredientId: selectedPurchaseIngredient._id, quantity, unitCostKobo }]);
    setPurchaseQuantity(""); setUnitCost(""); setError(null);
  };
  const removePurchaseLine = (index: number) => setPurchaseLines((current) => current.filter((_, position) => position !== index));
  const purchaseDraftTotalKobo = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCostKobo, 0);
  const savePurchase = async () => {
    if (!purchaseLines.length) { setError("Add at least one ingredient to the purchase."); return; }
    setSaving(true); setError(null);
    try { await receivePurchase({ supplier: supplier.trim() || undefined, paymentMethod: purchaseMethod, items: purchaseLines }); setPurchaseOpen(false); setSupplier(""); setPurchaseLines([]); setPurchaseQuantity(""); setUnitCost(""); setPurchaseMethod("cash"); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not receive purchase."); } finally { setSaving(false); }
  };
  const addDetailLine = async () => {
    if (!purchaseDetailId || !detailIngredient) { setError("Choose an ingredient first."); return; }
    const quantity = Number.parseFloat(detailQuantity);
    const unitCostKobo = nairaInputToKobo(detailUnitCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitCostKobo < 0) { setError("Enter a valid quantity and unit cost."); return; }
    setDetailSaving(true); setError(null);
    try { await addPurchaseItems({ purchaseId: purchaseDetailId, items: [{ ingredientId: detailIngredient._id, quantity, unitCostKobo }] }); setDetailQuantity(""); setDetailUnitCost(""); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not add to the purchase."); } finally { setDetailSaving(false); }
  };
  const removePurchaseNow = async () => {
    if (!purchaseDetailId) return;
    setDetailSaving(true); setError(null);
    try { await removePurchase({ purchaseId: purchaseDetailId }); setPurchaseDetailId(null); setDetailConfirmRemove(false); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not remove the purchase."); setDetailConfirmRemove(false); } finally { setDetailSaving(false); }
  };
  const startEditLine = (line: Doc<"purchaseItems">) => { setConfirmLineId(null); setEditingLineId(line._id); setEditLineQuantity(formatQuantity(line.quantity)); setEditLineUnitCost(String(Math.round(line.unitCostKobo / 100))); setError(null); };
  const cancelEditLine = () => { setEditingLineId(null); setEditLineQuantity(""); setEditLineUnitCost(""); setError(null); };
  const saveLineEdit = async () => {
    if (!editingLineId) return;
    const quantity = Number.parseFloat(editLineQuantity);
    const unitCostKobo = nairaInputToKobo(editLineUnitCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitCostKobo < 0) { setError("Enter a valid quantity and unit cost."); return; }
    setLineSaving(true); setError(null);
    try { await updatePurchaseItem({ lineId: editingLineId, quantity, unitCostKobo }); setEditingLineId(null); setEditLineQuantity(""); setEditLineUnitCost(""); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not update the purchase item."); } finally { setLineSaving(false); }
  };
  const removeLine = async (lineId: Id<"purchaseItems">) => {
    setLineSaving(true); setError(null);
    try { await removePurchaseItem({ lineId }); setConfirmLineId(null); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not remove the purchase item."); setConfirmLineId(null); } finally { setLineSaving(false); }
  };
  const saveShift = async () => {
    const cashKobo = nairaInputToKobo(shiftCash);
    if (cashKobo < 0) { setError("Enter a valid cash amount."); return; }
    setSaving(true); setError(null);
    try {
      if (shiftMode === "open") await startShift({ openingCashKobo: cashKobo });
      else if (currentShift) await endShift({ shiftId: currentShift._id, countedCashKobo: cashKobo, note: shiftNote.trim() || undefined });
      setShiftModalOpen(false); setShiftCash(""); setShiftNote("");
    } catch (shiftError) { setError(shiftError instanceof Error ? shiftError.message : "Could not update the shift."); } finally { setSaving(false); }
  };
  const beginEditMenuItem = (item: Doc<"menuItems">) => {
    setCreatingMenuItem(false); setEditingMenuItem(item); setEditName(item.name); setEditDescription(item.description ?? ""); setEditCategory(item.category); setEditPrice(String(Math.round(item.priceKobo / 100))); setEditActive(item.active); setEditSoldOut(item.soldOut === true); setRecipeIngredientId(null); setRecipeQuantity(""); setCategoryPickerOpen(false); setError(null);
  };
  const beginCreateMenuItem = () => {
    setCreatingMenuItem(true); setEditingMenuItem(null); setEditName(""); setEditDescription(""); setEditCategory(menuCategories?.find((category) => category.active)?.name ?? ""); setEditPrice(""); setEditActive(true); setEditSoldOut(false); setRecipeIngredientId(null); setRecipeQuantity(""); setCategoryPickerOpen(false); setError(null);
  };
  const saveMenuItem = async () => {
    const priceKobo = nairaInputToKobo(editPrice);
    if (!editName.trim() || !editCategory || priceKobo <= 0) { setError("Add a name, choose a category and enter a price greater than zero."); return; }
    setSaving(true); setError(null);
    try { if (creatingMenuItem) await createMenuItem({ name: editName, description: editDescription, category: editCategory, priceKobo }); else if (editingMenuItem) await updateMenuItem({ menuItemId: editingMenuItem._id, name: editName, description: editDescription, category: editCategory, priceKobo, active: editActive, soldOut: editSoldOut }); setEditingMenuItem(null); setCreatingMenuItem(false); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save menu item."); } finally { setSaving(false); }
  };
  const saveCategory = async () => {
    if (!categoryDraftName.trim()) { setError("Enter a category name."); return; }
    setCategorySaving(true); setError(null);
    try {
      if (editingCategory) await renameMenuCategory({ categoryId: editingCategory._id, name: categoryDraftName });
      else await createMenuCategory({ name: categoryDraftName });
      Keyboard.dismiss();
      setCategoryFormOpen(false); setEditingCategory(null); setCategoryDraftName("");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save category."); }
    finally { setCategorySaving(false); }
  };
  const saveRecipe = async () => {
    if (!editingMenuItem || !recipeIngredientId) { setError("Choose an ingredient first."); return; }
    const quantity = Number.parseFloat(recipeQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) { setError("Enter a recipe quantity greater than zero."); return; }
    setSaving(true); setError(null);
    try { await upsertRecipe({ menuItemId: editingMenuItem._id, ingredientId: recipeIngredientId, quantity }); setRecipeIngredientId(null); setRecipeQuantity(""); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save recipe."); } finally { setSaving(false); }
  };
  const saveStaff = async () => {
    if (!staffName.trim() || staffPin.length !== 6) { setError("Enter a name and an exact six-digit PIN."); return; }
    setSaving(true); setError(null);
    try {
      await createStaff({ name: staffName.trim(), phone: normalizePhoneForLogin(staffPhone), pin: staffPin, role: staffRole });
      setStaffModalOpen(false);
      setStaffName(""); setStaffPhone(""); setStaffPin("");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not create the staff account."); }
    finally { setSaving(false); }
  };
  const savePin = async () => {
    if (newPin.length !== 6) { setError("Enter a six-digit PIN."); return; }
    if (pinMode === "change" && currentPin.length !== 6) { setError("Enter your current PIN."); return; }
    setSaving(true); setError(null);
    try {
      if (pinMode === "change") await changePin({ currentPin, newPin });
      else if (pinTarget) await resetStaffPin({ userId: pinTarget._id, newPin });
      setPinModalOpen(false); setCurrentPin(""); setNewPin(""); setPinTarget(null);
    } catch (pinError) { setError(pinError instanceof Error ? pinError.message : "Could not update the PIN."); }
    finally { setSaving(false); }
  };

  const runReset = async () => {
    setResetSaving(true); setResetError(null); setResetNotice(null);
    try {
      const result = await resetAllData({ confirm: resetConfirm, reseed: resetReseed });
      if (result.finished) {
        setResetOpen(false); setResetConfirm(""); setResetReseed(true);
      } else {
        setResetNotice("Almost done — the remaining records are clearing in the background.");
      }
    } catch (resetFailure) {
      setResetError(resetFailure instanceof Error ? resetFailure.message : "Could not reset the data.");
    } finally {
      setResetSaving(false);
    }
  };

  return (
    <View style={styles.moreScreen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.moreContent, { paddingBottom: 112 + bottomInset }]} showsVerticalScrollIndicator={false}>
      <View style={styles.moreHeader}><View style={styles.headerBrandRow}><BrandMark size={30} /><Text style={styles.moreTitle}>Money & more</Text></View><Pressable style={styles.moreIcon} onPress={() => setRoleModalOpen(true)}><Ionicons name="person-circle-outline" size={26} color="#A34A30" /></Pressable></View>
        <Text style={styles.moreIntro}>Keep the day’s spending and stock purchases in one place.</Text>
        <View style={styles.roleBanner}><Ionicons name="shield-checkmark-outline" size={19} color="#557451" /><Text style={styles.roleBannerText}>{roleLabel(role)} access</Text><Pressable onPress={() => setRoleModalOpen(true)}><Text style={styles.roleChangeText}>Change</Text></Pressable></View>
        <View style={styles.moreTabs}>{sections.map((section) => <Pressable key={section} style={[styles.moreTab, moreSection === section && styles.moreTabActive]} onPress={() => setMoreSection(section)}><Text style={[styles.moreTabText, moreSection === section && styles.moreTabTextActive]}>{section === "overview" ? "Overview" : section === "money" ? "Money" : "Setup"}</Text></Pressable>)}</View>
        {moreSection === "overview" && <>
        {role !== "kitchen" && <View style={styles.shiftCard}>
          <View style={styles.shiftCardIcon}><Ionicons name={currentShift ? "lock-open-outline" : "lock-closed-outline"} size={23} color={currentShift ? "#557451" : "#A34A30"} /></View>
          <View style={styles.shiftCardMain}><Text style={styles.shiftCardTitle}>{currentShift ? "Shift is open" : "No shift open"}</Text><Text style={styles.shiftCardCopy}>{currentShift ? `Expected cash · ${formatNaira(currentShift.expectedCashKobo)}` : "Open a shift before taking cash payments."}</Text></View>
          <Pressable style={[styles.shiftButton, currentShift && styles.shiftCloseButton]} onPress={() => { setShiftMode(currentShift ? "close" : "open"); setShiftCash(""); setError(null); setShiftModalOpen(true); }}><Text style={[styles.shiftButtonText, currentShift && styles.shiftCloseButtonText]}>{currentShift ? "Close" : "Open"}</Text></Pressable>
        </View>}
        {canSeeMoney && <View style={styles.moneySummaryCard}>
          <View style={styles.moneySummaryHeader}><View><Text style={styles.moneySummaryEyebrow}>TODAY&apos;S MONEY</Text><Text style={styles.moneySummaryTotal}>{formatNaira(moneySummary?.netCollectedKobo ?? 0)}</Text><Text style={styles.moneySummaryCaption}>{moneySummary?.orderCount ?? 0} paid orders · net collected</Text></View><View style={styles.moneySummaryIcon}><Ionicons name="trending-up" size={24} color="#F8DFA9" /></View></View>
          <View style={styles.moneySummaryDivider} />
          <View style={styles.moneySummaryGrid}><View><Text style={styles.moneyMetricLabel}>Cash</Text><Text style={styles.moneyMetricValue}>{formatNaira(moneySummary?.cashKobo ?? 0)}</Text></View><View><Text style={styles.moneyMetricLabel}>Card</Text><Text style={styles.moneyMetricValue}>{formatNaira(moneySummary?.cardKobo ?? 0)}</Text></View><View><Text style={styles.moneyMetricLabel}>Transfer</Text><Text style={styles.moneyMetricValue}>{formatNaira(moneySummary?.transferKobo ?? 0)}</Text></View></View>
          <View style={styles.moneyCostRow}><Text style={styles.moneyCostLabel}>Refunds {formatNaira(moneySummary?.refundedKobo ?? 0)}</Text><Text style={styles.moneyCostLabel}>Food cost {formatNaira(moneySummary?.foodCostKobo ?? 0)}</Text><Text style={styles.moneyCostLabel}>Expenses {formatNaira(moneySummary?.expensesKobo ?? 0)}</Text><Text style={styles.moneyCostLabel}>Purchases {formatNaira(moneySummary?.purchasesKobo ?? 0)}</Text></View>
          <View style={styles.moneySummaryDivider} />
          <View style={styles.moneyCostRow}><Text style={styles.moneySummaryEyebrow}>ESTIMATED PROFIT</Text><Text style={styles.moneyMetricValue}>{formatNaira(moneySummary?.estimatedProfitKobo ?? 0)}</Text></View>
          <Text style={styles.moneyCostLabel}>Net collected − food cost − expenses</Text>
        </View>}
        {canSeeMoney && <View style={styles.moneyActionRow}>
          <Pressable style={styles.moneyAction} onPress={() => { setError(null); setExpenseOpen(true); }}><View style={[styles.moneyActionIcon, { backgroundColor: "#F7E4DC" }]}><Ionicons name="receipt-outline" size={24} color="#A34A30" /></View><Text style={styles.moneyActionTitle}>Add expense</Text><Text style={styles.moneyActionCopy}>Record operating spend</Text></Pressable>
          <Pressable style={styles.moneyAction} onPress={() => { setError(null); setPurchaseOpen(true); }}><View style={[styles.moneyActionIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="cart-outline" size={24} color="#557451" /></View><Text style={styles.moneyActionTitle}>Receive purchase</Text><Text style={styles.moneyActionCopy}>Add stock and cost</Text></Pressable>
        </View>}
        </>}
        {moreSection === "setup" && canManageMenu && <>
          <Pressable style={styles.manageMenuButton} onPress={() => { setMenuOpen(true); setError(null); }}><View style={styles.manageMenuIcon}><Ionicons name="restaurant-outline" size={23} color="#A34A30" /></View><View style={styles.manageMenuMain}><Text style={styles.moneyActionTitle}>Manage menu & recipes</Text><Text style={styles.moneyActionCopy}>Add dishes, edit prices and recipes</Text></View><Ionicons name="chevron-forward" size={19} color="#B0AAA4" /></Pressable>
          <Pressable style={styles.manageMenuButton} onPress={() => { setCategoryFormOpen(false); setCategorySaving(false); setCategoriesOpen(true); setError(null); }}><View style={[styles.manageMenuIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="file-tray-stacked-outline" size={23} color="#557451" /></View><View style={styles.manageMenuMain}><Text style={styles.moneyActionTitle}>Menu categories</Text><Text style={styles.moneyActionCopy}>Add or rename categories used by your menu</Text></View><Ionicons name="chevron-forward" size={19} color="#B0AAA4" /></Pressable>
          <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Staff accounts</Text><Text style={styles.moreSectionHint}>Owner-created access</Text></View>
          <Pressable style={styles.manageMenuButton} onPress={() => { setStaffName(""); setStaffPhone(""); setStaffPin(""); setStaffRole("cashier"); setError(null); setStaffModalOpen(true); }}><View style={styles.manageMenuIcon}><Ionicons name="person-add-outline" size={23} color="#A34A30" /></View><View style={styles.manageMenuMain}><Text style={styles.moneyActionTitle}>Create staff account</Text><Text style={styles.moneyActionCopy}>Set a phone number, role and six-digit PIN to hand over</Text></View><Ionicons name="chevron-forward" size={19} color="#B0AAA4" /></Pressable>
          {staffList?.filter((staff) => staff.role !== "owner").map((staff) => <View key={staff._id} style={styles.moneyListRow}><View style={styles.moneyListIcon}><Ionicons name="person-outline" size={18} color="#A34A30" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{staff.name ?? "Staff"}</Text><Text style={styles.moneyListMeta}>{staff.phone} · {staff.role}</Text></View><Pressable onPress={() => { setPinMode("reset"); setPinTarget(staff); setCurrentPin(""); setNewPin(""); setError(null); setPinModalOpen(true); }}><Text style={styles.roleChangeText}>PIN</Text></Pressable><Pressable onPress={() => setStaffActive({ userId: staff._id, active: staff.active === false })}><Text style={styles.roleChangeText}>{staff.active === false ? "Enable" : "Disable"}</Text></Pressable></View>)}
          <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Danger zone</Text><Text style={styles.moreSectionHint}>Cannot be undone</Text></View>
          <Pressable style={styles.dangerButton} onPress={() => { setResetConfirm(""); setResetReseed(true); setResetError(null); setResetNotice(null); setResetOpen(true); }}><View style={styles.dangerIcon}><Ionicons name="warning-outline" size={22} color="#A34A30" /></View><View style={styles.manageMenuMain}><Text style={styles.dangerTitle}>Reset all data</Text><Text style={styles.dangerCopy}>Erase orders, sales, stock and staff to start over</Text></View><Ionicons name="chevron-forward" size={19} color="#C99A8A" /></Pressable>
        </>}
        {moreSection === "money" && <>
        {canSeeMoney && <>
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Reports</Text><Text style={styles.moreSectionHint}>Sales and payments</Text></View>
        <View style={styles.reportPeriodRow}>{(["today", "week", "month"] as const).map((period) => <Pressable key={period} style={[styles.reportPeriodChip, reportPeriod === period && styles.reportPeriodChipActive]} onPress={() => setReportPeriod(period)}><Text style={[styles.reportPeriodText, reportPeriod === period && styles.reportPeriodTextActive]}>{period === "today" ? "Today" : period === "week" ? "7 days" : "30 days"}</Text></Pressable>)}</View>
        <View style={styles.reportCard}>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Net sales</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(reportSales?.netSalesKobo ?? 0)}</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Orders</Text><Text style={styles.shiftBreakdownValue}>{reportSales?.orderCount ?? 0}</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Average order</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(reportSales?.averageOrderKobo ?? 0)}</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Food cost</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(reportSales?.foodCostKobo ?? 0)} · {(reportSales?.foodCostPct ?? 0).toFixed(0)}%</Text></View>
          <View style={[styles.shiftBreakdownRow, styles.shiftBreakdownTotalRow]}><Text style={styles.shiftBreakdownTotalLabel}>Estimated profit</Text><Text style={styles.shiftBreakdownTotalValue}>{formatNaira(reportSales?.estimatedProfitKobo ?? 0)}</Text></View>
          <View style={styles.reportDivider} />
          <View style={styles.moneyCostRow}><Text style={styles.moneyCostLabel}>Cash {formatNaira(reportPayments?.cashKobo ?? 0)}</Text><Text style={styles.moneyCostLabel}>Card {formatNaira(reportPayments?.cardKobo ?? 0)}</Text><Text style={styles.moneyCostLabel}>Transfer {formatNaira(reportPayments?.transferKobo ?? 0)}</Text></View>
          <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Refunds</Text><Text style={[styles.shiftBreakdownValue, { color: "#A34A30" }]}>−{formatNaira(reportPayments?.refundedKobo ?? 0)}</Text></View>
        </View>
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Top sellers</Text><Text style={styles.moreSectionHint}>By quantity</Text></View>
        {reportTop?.length ? <View style={styles.groupedList}>{reportTop.map((item, index) => <View key={item.name} style={[styles.attentionItem, index < reportTop.length - 1 && styles.divider]}><View style={styles.rankBadge}><Text style={styles.rankText}>{index + 1}</Text></View><View style={styles.attentionCopy}><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.itemMeta}>{formatNaira(item.revenueKobo)}</Text></View><Text style={styles.rankQty}>{item.quantity}</Text></View>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No sales in this period.</Text></View>}
        </>}
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Recent expenses</Text><Text style={styles.moreSectionHint}>{recentExpenses?.length ?? 0} recorded</Text></View>
        {recentExpenses?.length ? <View style={styles.moneyList}>{recentExpenses.slice(0, 5).map((expense) => <View key={expense._id} style={styles.moneyListRow}><View style={styles.moneyListIcon}><Ionicons name="receipt-outline" size={18} color="#A34A30" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{expense.description}</Text><Text style={styles.moneyListMeta}>{formatShortDate(expense.createdAt)}</Text></View><Text style={styles.moneyListAmount}>{formatNaira(expense.amountKobo)}</Text></View>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No expenses recorded yet.</Text></View>}
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Suppliers today</Text><Text style={styles.moreSectionHint}>{formatNaira(moneySummary?.purchasesKobo ?? 0)} spent</Text></View>
        {supplierSummary?.length ? <View style={styles.moneyList}>{supplierSummary.slice(0, 5).map((group) => <View key={group.supplier ?? "unspecified"} style={styles.moneyListRow}><View style={[styles.moneyListIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="people-outline" size={18} color="#557451" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{group.supplier || "No supplier name"}</Text><Text style={styles.moneyListMeta}>{group.count} {group.count === 1 ? "purchase" : "purchases"} · last {formatShortDate(group.lastAt)}</Text></View><Text style={styles.moneyListAmount}>{formatNaira(group.totalKobo)}</Text></View>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No supplier spending recorded today.</Text></View>}
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Recent purchases</Text><Text style={styles.moreSectionHint}>Tap for line items</Text></View>
        {recentPurchases?.length ? <View style={styles.moneyList}>{recentPurchases.slice(0, 5).map((purchase) => <Pressable key={purchase._id} style={styles.moneyListRow} onPress={() => { setError(null); setDetailConfirmRemove(false); setDetailQuantity(""); setDetailUnitCost(""); setEditingLineId(null); setConfirmLineId(null); setPurchaseDetailId(purchase._id); }}><View style={[styles.moneyListIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="cart-outline" size={18} color="#557451" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{purchase.supplier || "Stock purchase"}</Text><Text style={styles.moneyListMeta}>{formatShortDate(purchase.createdAt)}</Text></View><Text style={styles.moneyListAmount}>{formatNaira(purchase.totalKobo)}</Text><Ionicons name="chevron-forward" size={17} color="#B0AAA4" /></Pressable>)}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>No purchases received yet.</Text></View>}
        <View style={styles.moreSectionHeader}><Text style={styles.moreSectionTitle}>Closed shifts</Text><Text style={styles.moreSectionHint}>Tap to review</Text></View>
        {closedShifts?.length ? <View style={styles.moneyList}>{closedShifts.slice(0, 5).map((shift) => { const difference = shift.differenceKobo ?? 0; return <Pressable key={shift._id} style={styles.moneyListRow} onPress={() => { setError(null); setShiftReportId(shift._id); }}><View style={[styles.moneyListIcon, { backgroundColor: difference >= 0 ? "#E4EEE0" : "#F7E4DC" }]}><Ionicons name="lock-closed-outline" size={18} color={difference >= 0 ? "#557451" : "#A34A30"} /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{formatShortDate(shift.closedAt ?? shift.openedAt)} · Shift closed</Text><Text style={styles.moneyListMeta}>Expected {formatNaira(shift.expectedCashKobo)} · Counted {formatNaira(shift.countedCashKobo ?? 0)}</Text></View><Text style={[styles.moneyListAmount, { color: difference >= 0 ? "#557451" : "#A34A30" }]}>{difference >= 0 ? "+" : "−"}{formatNaira(Math.abs(difference))}</Text><Ionicons name="chevron-forward" size={17} color="#B0AAA4" /></Pressable>; })}</View> : <View style={styles.moreEmpty}><Text style={styles.moreEmptyText}>Closed shifts will appear here.</Text></View>}
        </>}
      </ScrollView>

      <Modal visible={staffModalOpen} transparent animationType="slide" onRequestClose={() => setStaffModalOpen(false)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setStaffModalOpen(false)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Create staff account</Text><Text style={styles.sheetSubtitle}>Give the PIN to this staff member directly.</Text></View><Pressable style={styles.sheetClose} onPress={() => setStaffModalOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View><Text style={styles.receiveLabel}>Staff name</Text><View style={styles.reasonInputWrap}><TextInput value={staffName} onChangeText={setStaffName} placeholder="Full name" placeholderTextColor="#A0A49D" style={styles.reasonInput} autoCapitalize="words" /></View><Text style={styles.receiveLabel}>Phone number</Text><View style={styles.reasonInputWrap}><TextInput value={staffPhone} onChangeText={setStaffPhone} placeholder="080 1234 5678" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="phone-pad" /></View><Text style={styles.receiveLabel}>Role</Text><View style={styles.moreTabs}>{(["manager", "cashier", "kitchen"] as const).map((item) => <Pressable key={item} style={[styles.moreTab, staffRole === item && styles.moreTabActive]} onPress={() => setStaffRole(item)}><Text style={[styles.moreTabText, staffRole === item && styles.moreTabTextActive]}>{roleLabel(item)}</Text></Pressable>)}</View><Text style={styles.receiveLabel}>Six-digit PIN</Text><View style={styles.reasonInputWrap}><TextInput value={staffPin} onChangeText={(value) => setStaffPin(value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View>{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}<Pressable style={[styles.sendButton, saving && styles.sendButtonDisabled]} onPress={saveStaff} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Create account</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}</Pressable></View></KeyboardAvoidingView></Modal>

      <Modal visible={expenseOpen} transparent animationType="slide" onRequestClose={() => setExpenseOpen(false)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setExpenseOpen(false)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Add expense</Text><Text style={styles.sheetSubtitle}>Record money spent outside stock.</Text></View><Pressable style={styles.sheetClose} onPress={() => setExpenseOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View><Text style={styles.receiveLabel}>Paid with</Text><View style={styles.moreTabs}>{(["cash", "card", "transfer"] as const).map((item) => <Pressable key={item} style={[styles.moreTab, expenseMethod === item && styles.moreTabActive]} onPress={() => setExpenseMethod(item)}><Text style={[styles.moreTabText, expenseMethod === item && styles.moreTabTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}</View><Text style={styles.receiveLabel}>Description</Text><View style={styles.reasonInputWrap}><TextInput value={description} onChangeText={(value) => { setDescription(value); setError(null); }} placeholder="e.g. Generator fuel" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View><Text style={styles.receiveLabel}>Amount</Text><View style={styles.cashInputWrap}><Text style={styles.cashPrefix}>₦</Text><TextInput value={expenseAmount} onChangeText={(value) => { setExpenseAmount(cleanMoneyInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.cashInput} autoFocus /></View>{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}<Pressable style={[styles.sendButton, saving && styles.sendButtonDisabled]} onPress={saveExpense} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Save expense</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}</Pressable></View></KeyboardAvoidingView></Modal>

      <Modal visible={purchaseOpen} transparent animationType="slide" onRequestClose={() => setPurchaseOpen(false)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setPurchaseOpen(false)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Receive purchase</Text><Text style={styles.sheetSubtitle}>Add every ingredient on this supplier bill.</Text></View><Pressable style={styles.sheetClose} onPress={() => { Keyboard.dismiss(); setPurchaseOpen(false); }}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View><ScrollView style={styles.moneySheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Text style={styles.receiveLabel}>Supplier (optional)</Text><View style={styles.reasonInputWrap}><TextInput value={supplier} onChangeText={setSupplier} placeholder="e.g. Oke Arin Market" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View><Text style={styles.receiveLabel}>Paid with</Text><View style={styles.moreTabs}>{(["cash", "card", "transfer"] as const).map((item) => <Pressable key={item} style={[styles.moreTab, purchaseMethod === item && styles.moreTabActive]} onPress={() => setPurchaseMethod(item)}><Text style={[styles.moreTabText, purchaseMethod === item && styles.moreTabTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}</View><Text style={styles.receiveLabel}>Ingredient</Text>{ingredients?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ingredientPicker}>{ingredients.filter((ingredient) => ingredient.active !== false).map((ingredient) => { const active = selectedPurchaseIngredient?._id === ingredient._id; return <Pressable key={ingredient._id} style={[styles.ingredientChip, active && styles.ingredientChipActive]} onPress={() => setPurchaseIngredientId(ingredient._id)}><Text style={[styles.ingredientChipText, active && styles.ingredientChipTextActive]}>{ingredient.name}</Text></Pressable>; })}</ScrollView> : <Text style={styles.moreEmptyText}>Loading ingredients…</Text>}<View style={styles.purchaseFieldRow}><View style={styles.feeField}><Text style={styles.receiveLabel}>Quantity</Text><View style={styles.moneyInputWrap}><TextInput value={purchaseQuantity} onChangeText={(value) => { setPurchaseQuantity(cleanDecimalInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{selectedPurchaseIngredient?.unit}</Text></View></View><View style={styles.feeField}><Text style={styles.receiveLabel}>Unit cost</Text><View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={unitCost} onChangeText={(value) => { setUnitCost(cleanMoneyInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View></View></View><Pressable style={styles.addLineButton} onPress={addPurchaseLine}><Ionicons name="add" size={18} color="#557451" /><Text style={styles.addLineText}>Add item to purchase</Text></Pressable>{purchaseLines.length > 0 && <View style={styles.purchaseLinesList}>{purchaseLines.map((line, index) => { const ingredient = ingredients?.find((row) => row._id === line.ingredientId); return <View key={`${line.ingredientId}-${index}`} style={styles.purchaseLineRow}><View style={styles.purchaseLineMain}><Text style={styles.purchaseLineName}>{ingredient?.name ?? "Ingredient"}</Text><Text style={styles.purchaseLineMeta}>{formatQuantity(line.quantity)} {ingredient?.unit ?? ""} · {formatNaira(line.unitCostKobo)} each</Text></View><Text style={styles.purchaseLineTotal}>{formatNaira(line.quantity * line.unitCostKobo)}</Text><Pressable onPress={() => removePurchaseLine(index)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#A34A30" /></Pressable></View>; })}</View>}{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}<Pressable style={[styles.sendButton, (saving || !purchaseLines.length) && styles.sendButtonDisabled]} onPress={savePurchase} disabled={saving || !purchaseLines.length}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Receive purchase{purchaseLines.length ? ` · ${formatNaira(purchaseDraftTotalKobo)}` : ""}</Text><Ionicons name="cart" size={20} color="#FFFFFF" /></>}</Pressable></ScrollView></View></KeyboardAvoidingView></Modal>

      <Modal visible={purchaseDetailId !== null} transparent animationType="slide" onRequestClose={() => { setError(null); setPurchaseDetailId(null); }}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => { setError(null); setPurchaseDetailId(null); }} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{purchaseDetail?.purchase.supplier || "Stock purchase"}</Text><Text style={styles.sheetSubtitle}>{purchaseDetail ? `${formatShortDate(purchaseDetail.purchase.createdAt)} · paid by ${purchaseDetail.purchase.paymentMethod ?? "cash"}` : "Loading purchase…"}</Text></View><Pressable style={styles.sheetClose} onPress={() => { setError(null); setPurchaseDetailId(null); }}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View>{purchaseDetail ? <ScrollView style={styles.moneySheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View style={styles.purchaseLinesList}>{purchaseDetail.lines.map((line) => <View key={line._id} style={styles.purchaseLineBlock}>{editingLineId === line._id ? <View style={styles.purchaseLineRow}><View style={styles.purchaseLineMain}><Text style={styles.purchaseLineName}>{line.ingredientName}</Text><View style={styles.purchaseFieldRow}><View style={styles.feeField}><View style={styles.moneyInputWrap}><TextInput value={editLineQuantity} onChangeText={(value) => { setEditLineQuantity(cleanDecimalInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{line.unit}</Text></View></View><View style={styles.feeField}><View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={editLineUnitCost} onChangeText={(value) => { setEditLineUnitCost(cleanMoneyInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View></View></View></View><View style={styles.lineEditActions}><Pressable style={[styles.lineSaveButton, lineSaving && styles.sendButtonDisabled]} onPress={saveLineEdit} disabled={lineSaving}>{lineSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.lineSaveText}>Save</Text>}</Pressable><Pressable onPress={cancelEditLine} hitSlop={8}><Text style={styles.lineCancelText}>Cancel</Text></Pressable></View></View> : <View style={styles.purchaseLineRow}><View style={styles.purchaseLineMain}><Text style={styles.purchaseLineName}>{line.ingredientName}</Text><Text style={styles.purchaseLineMeta}>{formatQuantity(line.quantity)} {line.unit} · {formatNaira(line.unitCostKobo)} each</Text></View><Text style={styles.purchaseLineTotal}>{formatNaira(line.totalKobo)}</Text>{purchaseDetail.editable && <View style={styles.lineActions}><Pressable onPress={() => startEditLine(line)} hitSlop={8}><Ionicons name="pencil" size={16} color="#557451" /></Pressable><Pressable onPress={() => { setError(null); setEditingLineId(null); setConfirmLineId(confirmLineId === line._id ? null : line._id); }} hitSlop={8}><Ionicons name="trash-outline" size={16} color="#A34A30" /></Pressable></View>}</View>}{confirmLineId === line._id && <View style={styles.lineConfirmStrip}><Text style={styles.purchaseLineMeta}>Remove {line.ingredientName} from this purchase? Stock goes back.</Text><View style={styles.lineConfirmActions}><Pressable onPress={() => { setConfirmLineId(null); setError(null); }} hitSlop={8}><Text style={styles.lineCancelText}>Keep</Text></Pressable><Pressable style={[styles.lineRemoveButton, lineSaving && styles.sendButtonDisabled]} onPress={() => removeLine(line._id)} disabled={lineSaving}>{lineSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.lineRemoveText}>Remove</Text>}</Pressable></View></View>}</View>)}</View><View style={styles.purchaseDetailTotalRow}><Text style={styles.purchaseLineName}>Total</Text><Text style={styles.purchaseDetailTotal}>{formatNaira(purchaseDetail.purchase.totalKobo)}</Text></View>{purchaseDetail.purchase.note ? <Text style={styles.purchaseLineMeta}>{purchaseDetail.purchase.note}</Text> : null}{purchaseDetail.editable ? <><Text style={styles.receiveLabel}>Add another item</Text>{ingredients?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ingredientPicker}>{ingredients.filter((ingredient) => ingredient.active !== false).map((ingredient) => { const active = detailIngredient?._id === ingredient._id; return <Pressable key={ingredient._id} style={[styles.ingredientChip, active && styles.ingredientChipActive]} onPress={() => setDetailIngredientId(ingredient._id)}><Text style={[styles.ingredientChipText, active && styles.ingredientChipTextActive]}>{ingredient.name}</Text></Pressable>; })}</ScrollView> : <Text style={styles.moreEmptyText}>Loading ingredients…</Text>}<View style={styles.purchaseFieldRow}><View style={styles.feeField}><Text style={styles.receiveLabel}>Quantity</Text><View style={styles.moneyInputWrap}><TextInput value={detailQuantity} onChangeText={(value) => { setDetailQuantity(cleanDecimalInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{detailIngredient?.unit}</Text></View></View><View style={styles.feeField}><Text style={styles.receiveLabel}>Unit cost</Text><View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={detailUnitCost} onChangeText={(value) => { setDetailUnitCost(cleanMoneyInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View></View></View><Pressable style={[styles.addLineButton, detailSaving && styles.sendButtonDisabled]} onPress={addDetailLine} disabled={detailSaving}>{detailSaving ? <ActivityIndicator color="#557451" /> : <><Ionicons name="add" size={18} color="#557451" /><Text style={styles.addLineText}>Add item to this purchase</Text></>}</Pressable>{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}{detailConfirmRemove ? <><Text style={styles.purchaseLineMeta}>This returns the stock and removes the purchase record.</Text><View style={styles.detailActionRow}><Pressable style={styles.detailCancelButton} onPress={() => { setDetailConfirmRemove(false); setError(null); }}><Text style={styles.detailCancelText}>Keep it</Text></Pressable><Pressable style={[styles.detailRemoveButton, detailSaving && styles.sendButtonDisabled]} onPress={removePurchaseNow} disabled={detailSaving}>{detailSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.detailRemoveText}>Remove purchase</Text>}</Pressable></View></> : <Pressable style={styles.removePurchaseLink} onPress={() => { setError(null); setDetailConfirmRemove(true); }}><Ionicons name="trash-outline" size={17} color="#A34A30" /><Text style={styles.removePurchaseText}>Remove this purchase</Text></Pressable>}</> : <View style={styles.lockedNotice}><Ionicons name="lock-closed-outline" size={16} color="#887E76" /><Text style={styles.purchaseLineMeta}>This purchase belongs to a closed shift, so it is locked.</Text></View>}</ScrollView> : <Text style={styles.moreEmptyText}>Loading purchase lines…</Text>}</View></KeyboardAvoidingView></Modal>

      <Modal visible={shiftModalOpen} transparent animationType="slide" onRequestClose={() => setShiftModalOpen(false)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setShiftModalOpen(false)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{shiftMode === "open" ? "Open shift" : "Close shift"}</Text><Text style={styles.sheetSubtitle}>{shiftMode === "open" ? "Count the cash in the drawer before service." : "Count the drawer and compare it with expected cash."}</Text></View><Pressable style={styles.sheetClose} onPress={() => setShiftModalOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View><ScrollView style={styles.moneySheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{shiftMode === "close" && currentShift && <View style={styles.shiftBreakdown}><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Opening cash</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(currentShift.openingCashKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash sales</Text><Text style={styles.shiftBreakdownValue}>+{formatNaira(currentShift.cashPaidKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash refunds</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(currentShift.cashRefundedKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash expenses</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(currentShift.cashExpensesKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash purchases</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(currentShift.cashPurchasesKobo)}</Text></View><View style={[styles.shiftBreakdownRow, styles.shiftBreakdownTotalRow]}><Text style={styles.shiftBreakdownTotalLabel}>Expected cash</Text><Text style={styles.shiftBreakdownTotalValue}>{formatNaira(currentShift.expectedCashKobo)}</Text></View></View>}<Text style={styles.receiveLabel}>{shiftMode === "open" ? "Opening cash" : "Counted cash"}</Text><View style={styles.cashInputWrap}><Text style={styles.cashPrefix}>₦</Text><TextInput value={shiftCash} onChangeText={(value) => { setShiftCash(cleanMoneyInput(value)); setError(null); }} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.cashInput} autoFocus /></View>{shiftMode === "close" && currentShift && shiftCash !== "" && <View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Difference</Text><Text style={[styles.shiftBreakdownValue, { color: nairaInputToKobo(shiftCash) - currentShift.expectedCashKobo === 0 ? "#557451" : "#A34A30" }]}>{formatCashDifference(nairaInputToKobo(shiftCash) - currentShift.expectedCashKobo)}</Text></View>}{shiftMode === "close" && currentShift && shiftCash !== "" && nairaInputToKobo(shiftCash) - currentShift.expectedCashKobo !== 0 && <><Text style={styles.receiveLabel}>Note</Text><View style={styles.reasonInputWrap}><TextInput value={shiftNote} onChangeText={(value) => { setShiftNote(value); setError(null); }} placeholder="Explain the difference" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View></>}{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}<Pressable style={[styles.sendButton, saving && styles.sendButtonDisabled]} onPress={saveShift} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>{shiftMode === "open" ? "Open shift" : "Close shift"}</Text><Ionicons name={shiftMode === "open" ? "lock-open" : "lock-closed"} size={20} color="#FFFFFF" /></>}</Pressable></ScrollView></View></KeyboardAvoidingView></Modal>

      <Modal visible={shiftReportId !== null} transparent animationType="slide" onRequestClose={() => setShiftReportId(null)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setShiftReportId(null)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Shift report</Text><Text style={styles.sheetSubtitle}>{shiftReport ? `${formatShortDate(shiftReport.openedAt)} · closed ${formatShortDate(shiftReport.closedAt ?? shiftReport.openedAt)}` : "Loading shift…"}</Text></View><Pressable style={styles.sheetClose} onPress={() => setShiftReportId(null)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View>{shiftReport ? <ScrollView style={styles.moneySheetScroll} showsVerticalScrollIndicator={false}><View style={styles.shiftBreakdown}><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Opening cash</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(shiftReport.openingCashKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash sales</Text><Text style={styles.shiftBreakdownValue}>+{formatNaira(shiftReport.cashPaidKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash refunds</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(shiftReport.cashRefundedKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash expenses</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(shiftReport.cashExpensesKobo)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash purchases</Text><Text style={styles.shiftBreakdownValue}>−{formatNaira(shiftReport.cashPurchasesKobo)}</Text></View><View style={[styles.shiftBreakdownRow, styles.shiftBreakdownTotalRow]}><Text style={styles.shiftBreakdownTotalLabel}>Expected cash</Text><Text style={styles.shiftBreakdownTotalValue}>{formatNaira(shiftReport.expectedCashKobo)}</Text></View></View><View style={styles.shiftBreakdown}><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Cash counted</Text><Text style={styles.shiftBreakdownValue}>{formatNaira(shiftReport.countedCashKobo ?? 0)}</Text></View><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Difference</Text><Text style={[styles.shiftBreakdownValue, { color: (shiftReport.differenceKobo ?? 0) === 0 ? "#557451" : "#A34A30" }]}>{formatCashDifference(shiftReport.differenceKobo ?? 0)}</Text></View></View><View style={styles.shiftBreakdown}><View style={styles.shiftBreakdownRow}><Text style={styles.shiftBreakdownLabel}>Closed by</Text><Text style={styles.shiftBreakdownValue}>{shiftReport.closerName || "Unknown"}</Text></View></View>{shiftReport.note ? <><Text style={styles.receiveLabel}>Note</Text><Text style={styles.purchaseLineMeta}>{shiftReport.note}</Text></> : null}</ScrollView> : <Text style={styles.moreEmptyText}>Loading shift…</Text>}</View></KeyboardAvoidingView></Modal>

      <Modal visible={roleModalOpen} transparent animationType="slide" onRequestClose={() => setRoleModalOpen(false)}><View style={styles.modalRoot}><Pressable style={styles.modalBackdrop} onPress={() => setRoleModalOpen(false)} /><View style={[styles.roleSheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Staff account</Text><Text style={styles.sheetSubtitle}>{roleLabel(role)} access</Text></View><Pressable style={styles.sheetClose} onPress={() => setRoleModalOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View><Pressable style={styles.signOutButton} onPress={() => { setRoleModalOpen(false); onSignOut(); }}><Ionicons name="log-out-outline" size={19} color="#A84629" /><Text style={styles.signOutText}>Sign out</Text></Pressable>
        <Pressable style={styles.signOutButton} onPress={() => { setRoleModalOpen(false); setPinMode("change"); setPinTarget(null); setCurrentPin(""); setNewPin(""); setError(null); setPinModalOpen(true); }}><Ionicons name="key-outline" size={19} color="#557451" /><Text style={styles.signOutText}>Change my PIN</Text></Pressable>
      </View></View></Modal>

      <Modal visible={pinModalOpen} transparent animationType="slide" onRequestClose={() => setPinModalOpen(false)}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setPinModalOpen(false)} /><View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{pinMode === "change" ? "Change my PIN" : `Reset ${pinTarget?.name ?? "staff"} PIN`}</Text><Text style={styles.sheetSubtitle}>{pinMode === "change" ? "Pick a new six-digit PIN for your sign-in." : "Hand this new PIN to the staff member directly."}</Text></View><Pressable style={styles.sheetClose} onPress={() => setPinModalOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View>{pinMode === "change" && <><Text style={styles.receiveLabel}>Current PIN</Text><View style={styles.reasonInputWrap}><TextInput value={currentPin} onChangeText={(v) => { setCurrentPin(v.replace(/\D/g, "").slice(0, 6)); setError(null); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} /></View></>}<Text style={styles.receiveLabel}>New 6-digit PIN</Text><View style={styles.reasonInputWrap}><TextInput value={newPin} onChangeText={(v) => { setNewPin(v.replace(/\D/g, "").slice(0, 6)); setError(null); }} placeholder="••••••" placeholderTextColor="#A0A49D" style={styles.reasonInput} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus /></View>{error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}<Pressable style={[styles.sendButton, saving && styles.sendButtonDisabled]} onPress={savePin} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>{pinMode === "change" ? "Change PIN" : "Set new PIN"}</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}</Pressable></View></KeyboardAvoidingView></Modal>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => { setMenuOpen(false); setEditingMenuItem(null); setCreatingMenuItem(false); }}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => { setMenuOpen(false); setEditingMenuItem(null); setCreatingMenuItem(false); }} />
          <View style={[styles.menuManagerSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            {editingMenuItem || creatingMenuItem ? <>
              <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{creatingMenuItem ? "Add menu item" : "Edit menu item"}</Text><Text style={styles.sheetSubtitle}>Changes appear in Sell immediately.</Text></View><Pressable style={styles.sheetClose} onPress={() => { setEditingMenuItem(null); setCreatingMenuItem(false); }}><Ionicons name="arrow-back" size={21} color="#4D534D" /></Pressable></View>
              <ScrollView style={styles.menuEditorScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.receiveLabel}>Name</Text><View style={styles.reasonInputWrap}><TextInput value={editName} onChangeText={setEditName} placeholder="e.g. Grilled fish" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View>
                <Text style={styles.receiveLabel}>Description</Text><View style={styles.reasonInputWrap}><TextInput value={editDescription} onChangeText={setEditDescription} placeholder="A short description" placeholderTextColor="#A0A49D" style={styles.reasonInput} /></View>
                <Text style={styles.receiveLabel}>Category</Text>
                <Pressable style={styles.categorySelect} onPress={() => setCategoryPickerOpen(!categoryPickerOpen)}><Text style={[styles.categorySelectText, !editCategory && styles.categoryPlaceholder]}>{editCategory || "Choose a category"}</Text><Ionicons name={categoryPickerOpen ? "chevron-up" : "chevron-down"} size={19} color="#756A62" /></Pressable>
                {categoryPickerOpen && <View style={styles.categoryOptions}>{menuCategories?.filter((category) => category.active).map((category) => <Pressable key={category._id} style={styles.categoryOption} onPress={() => { setEditCategory(category.name); setCategoryPickerOpen(false); }}><Text style={styles.categorySelectText}>{category.name}</Text>{editCategory === category.name && <Ionicons name="checkmark" size={18} color="#557451" />}</Pressable>)}</View>}
                <Text style={styles.receiveLabel}>Price</Text><View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>₦</Text><TextInput value={editPrice} onChangeText={(value) => setEditPrice(cleanMoneyInput(value))} placeholder="0" placeholderTextColor="#A0A49D" keyboardType="number-pad" style={styles.moneyInput} /></View>
                {!creatingMenuItem && <><Pressable style={styles.availabilityToggle} onPress={() => setEditActive(!editActive)}><Ionicons name={editActive ? "checkmark-circle" : "close-circle"} size={22} color={editActive ? "#557451" : "#A34A30"} /><Text style={styles.availabilityText}>{editActive ? "Available for sale" : "Hidden from sale"}</Text></Pressable>{editActive && <Pressable style={styles.availabilityToggle} onPress={() => setEditSoldOut(!editSoldOut)}><Ionicons name="alert-circle" size={22} color={editSoldOut ? "#A34A30" : "#A0A49D"} /><Text style={[styles.availabilityText, editSoldOut && { color: "#A34A30" }]}>{editSoldOut ? "Sold out" : "Sold out (temporarily unavailable)"}</Text></Pressable>}<Text style={styles.recipeTitle}>Recipe ingredients</Text>{recipeRows?.map((row) => <View key={row._id} style={styles.recipeRow}><Text style={styles.recipeName}>{row.ingredient?.name ?? "Ingredient"}</Text><Text style={styles.recipeQuantity}>{formatQuantity(row.quantity)} {row.ingredient?.unit ?? ""}</Text><Pressable onPress={() => removeRecipe({ recipeId: row._id })}><Ionicons name="trash-outline" size={18} color="#A34A30" /></Pressable></View>)}<View style={styles.recipeAddRow}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ingredientPicker}>{ingredients?.filter((ingredient) => ingredient.active !== false).map((ingredient) => <Pressable key={ingredient._id} style={[styles.ingredientChip, recipeIngredientId === ingredient._id && styles.ingredientChipActive]} onPress={() => setRecipeIngredientId(ingredient._id)}><Text style={[styles.ingredientChipText, recipeIngredientId === ingredient._id && styles.ingredientChipTextActive]}>{ingredient.name}</Text></Pressable>)}</ScrollView><View style={styles.moneyInputWrap}><TextInput value={recipeQuantity} onChangeText={(value) => setRecipeQuantity(cleanDecimalInput(value))} placeholder="Qty" placeholderTextColor="#A0A49D" keyboardType="decimal-pad" style={styles.moneyInput} /><Text style={styles.receiveUnit}>{ingredients?.find((ingredient) => ingredient._id === recipeIngredientId)?.unit}</Text></View><Pressable style={styles.addRecipeButton} onPress={saveRecipe}><Ionicons name="add" size={21} color="#FFFFFF" /></Pressable></View></>}
                {error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}
                <Pressable style={[styles.sendButton, saving && styles.sendButtonDisabled]} onPress={saveMenuItem} disabled={saving}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>{creatingMenuItem ? "Add menu item" : "Save menu item"}</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}</Pressable>
              </ScrollView>
            </> : <>
              <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Menu & recipes</Text><Text style={styles.sheetSubtitle}>Manage dishes and ingredient mappings.</Text></View><Pressable style={styles.sheetClose} onPress={() => setMenuOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable></View>
              <Pressable style={styles.menuAddButton} onPress={beginCreateMenuItem}><Ionicons name="add-circle" size={21} color="#FFFFFF" /><Text style={styles.sendButtonText}>Add menu item</Text></Pressable>
              <ScrollView style={styles.menuManagerList} showsVerticalScrollIndicator={false}>{(liveMenu ?? []).map((item) => <Pressable key={item._id} style={styles.menuManagerRow} onPress={() => beginEditMenuItem(item)}><View style={styles.menuManagerIcon}><Ionicons name="restaurant-outline" size={21} color="#A34A30" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{item.name}</Text><Text style={styles.moneyListMeta}>{item.category} · {item.active ? "Available" : "Hidden"}</Text></View><Text style={styles.moneyListAmount}>{formatNaira(item.priceKobo)}</Text><Ionicons name="chevron-forward" size={18} color="#B0AAA4" /></Pressable>)}</ScrollView>
            </>}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={categoriesOpen} transparent animationType="slide" onRequestClose={() => { setCategoryFormOpen(false); setCategoriesOpen(false); }}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => { setCategoryFormOpen(false); setCategoriesOpen(false); }} />
          <View style={[styles.menuManagerSheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            {categoryFormOpen ? <>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>{editingCategory ? "Rename category" : "Add category"}</Text>
                  <Text style={styles.sheetSubtitle}>Changes also update items in this category.</Text>
                </View>
                <Pressable style={styles.sheetClose} onPress={() => { Keyboard.dismiss(); setCategoryFormOpen(false); }}><Ionicons name="arrow-back" size={21} color="#4D534D" /></Pressable>
              </View>
              <Text style={styles.receiveLabel}>Category name</Text>
              <View style={styles.reasonInputWrap}><TextInput value={categoryDraftName} onChangeText={setCategoryDraftName} placeholder="e.g. Breakfast" placeholderTextColor="#A0A49D" style={styles.reasonInput} autoFocus /></View>
              {error && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{error}</Text></View>}
              <Pressable style={[styles.sendButton, categorySaving && styles.sendButtonDisabled]} onPress={saveCategory} disabled={categorySaving}>{categorySaving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>{editingCategory ? "Save category" : "Create category"}</Text><Ionicons name="checkmark" size={20} color="#FFFFFF" /></>}</Pressable>
            </> : <>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>Menu categories</Text>
                  <Text style={styles.sheetSubtitle}>Categories appear as filters in Sell.</Text>
                </View>
                <Pressable style={styles.sheetClose} onPress={() => setCategoriesOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
              </View>
              <ScrollView style={styles.menuManagerList}>{menuCategories?.map((category) => <Pressable key={category._id} style={styles.menuManagerRow} onPress={() => { setCategorySaving(false); setEditingCategory(category); setCategoryDraftName(category.name); setError(null); setCategoryFormOpen(true); }}><View style={[styles.menuManagerIcon, { backgroundColor: "#E4EEE0" }]}><Ionicons name="pricetag-outline" size={20} color="#557451" /></View><View style={styles.moneyListMain}><Text style={styles.moneyListTitle}>{category.name}</Text><Text style={styles.moneyListMeta}>{(liveMenu ?? []).filter((item) => item.category === category.name).length} menu items</Text></View><Text style={styles.moneyListMeta}>Rename</Text><Ionicons name="chevron-forward" size={18} color="#B0AAA4" /></Pressable>)}</ScrollView>
              <Pressable style={styles.menuAddButton} onPress={() => { setCategorySaving(false); setEditingCategory(null); setCategoryDraftName(""); setError(null); setCategoryFormOpen(true); }}><Ionicons name="add-circle" size={21} color="#FFFFFF" /><Text style={styles.sendButtonText}>Add category</Text></Pressable>
            </>}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={resetOpen} transparent animationType="slide" onRequestClose={() => setResetOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setResetOpen(false)} />
          <View style={[styles.moneySheet, { paddingBottom: Math.max(bottomInset, 18) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View><Text style={styles.sheetTitle}>Reset all data</Text><Text style={styles.sheetSubtitle}>This cannot be undone.</Text></View>
              <Pressable style={styles.sheetClose} onPress={() => setResetOpen(false)}><Ionicons name="close" size={21} color="#4D534D" /></Pressable>
            </View>
            <ScrollView style={styles.moneySheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.resetWarning}>
                <Ionicons name="warning-outline" size={20} color="#A34A30" />
                <Text style={styles.resetWarningText}>Erases every order, payment, refund, shift, expense, purchase, stock movement, ingredient, recipe and menu item. Staff accounts other than owners are removed too.</Text>
              </View>
              <Text style={styles.resetKeepText}>Your owner sign-in stays active so you can start over.</Text>
              <Pressable style={styles.availabilityToggle} onPress={() => setResetReseed(!resetReseed)}>
                <Ionicons name={resetReseed ? "checkbox" : "square-outline"} size={22} color={resetReseed ? "#557451" : "#A0A49D"} />
                <Text style={styles.availabilityText}>Load the starter menu and ingredients again</Text>
              </Pressable>
              <Text style={styles.receiveLabel}>Type RESET to confirm</Text>
              <View style={styles.reasonInputWrap}><TextInput value={resetConfirm} onChangeText={(value) => { setResetConfirm(value); setResetError(null); setResetNotice(null); }} placeholder="RESET" placeholderTextColor="#A0A49D" style={styles.reasonInput} autoCapitalize="characters" /></View>
              {resetNotice && <Text style={styles.resetKeepText}>{resetNotice}</Text>}
              {resetError && <View style={styles.paymentErrorBox}><Ionicons name="alert-circle" size={18} color="#A84F37" /><Text style={styles.paymentErrorText}>{resetError}</Text></View>}
              <Pressable style={[styles.sendButton, styles.resetButton, (resetSaving || resetConfirm.trim().toUpperCase() !== "RESET") && styles.sendButtonDisabled]} onPress={runReset} disabled={resetSaving || resetConfirm.trim().toUpperCase() !== "RESET"}>
                {resetSaving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.sendButtonText}>Erase everything</Text><Ionicons name="trash-outline" size={20} color="#FFFFFF" /></>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function formatShortDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function getTodayBounds() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return { from, to: from + 24 * 60 * 60 * 1000 };
}

function getRangeBounds(days: number) {
  const { to } = getTodayBounds();
  return { from: to - days * 24 * 60 * 60 * 1000, to };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(0)}%`;
}

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function KitchenScreen({ bottomInset }: { bottomInset: number }) {
  const activeOrders = useQuery(api.orders.active);
  const updateKitchenStatus = useMutation(api.orders.updateKitchenStatus);
  const [status, setStatus] = useState<KitchenStatus>("new");
  const [now, setNow] = useState(Date.now());
  const [transitioningId, setTransitioningId] = useState<Id<"orders"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const counts: Record<KitchenStatus, number> = {
    new: activeOrders?.filter((order) => order.status === "new").length ?? 0,
    preparing: activeOrders?.filter((order) => order.status === "preparing").length ?? 0,
    ready: activeOrders?.filter((order) => order.status === "ready").length ?? 0,
  };
  const visibleOrders = activeOrders?.filter((order) => order.status === status) ?? [];

  const moveOrder = async (orderId: Id<"orders">, nextStatus: "preparing" | "ready" | "completed") => {
    if (transitioningId) return;
    setTransitioningId(orderId);
    setError(null);
    try {
      await updateKitchenStatus({ orderId, nextStatus });
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Could not update the order.");
    } finally {
      setTransitioningId(null);
    }
  };

  return (
    <View style={styles.kitchenScreen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.kitchenContent, { paddingBottom: 112 + bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.kitchenHeader}>
          <View style={styles.headerBrandRow}>
            <BrandMark size={28} />
            <Text style={styles.kitchenTitle}>Kitchen queue</Text>
          </View>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>Live</Text></View>
        </View>

        <View style={styles.kitchenSummary}>
          <View><Text style={styles.kitchenSummaryValue}>{counts.new + counts.preparing}</Text><Text style={styles.kitchenSummaryLabel}>Cooking queue</Text></View>
          <View style={styles.kitchenSummaryDivider} />
          <View><Text style={[styles.kitchenSummaryValue, { color: "#50734F" }]}>{counts.ready}</Text><Text style={styles.kitchenSummaryLabel}>Ready now</Text></View>
          <View style={styles.kitchenSummaryArt}><Ionicons name="restaurant" size={29} color="#F8DDAD" /></View>
        </View>

        <View style={styles.kitchenTabs}>
          {(["new", "preparing", "ready"] as KitchenStatus[]).map((item) => {
            const active = status === item;
            return (
              <Pressable key={item} style={[styles.kitchenTab, active && styles.kitchenTabActive]} onPress={() => setStatus(item)}>
                <Text style={[styles.kitchenTabText, active && styles.kitchenTabTextActive]}>{item === "new" ? "New" : item === "preparing" ? "Preparing" : "Ready"}</Text>
                <View style={[styles.kitchenTabCount, active && styles.kitchenTabCountActive]}><Text style={[styles.kitchenTabCountText, active && styles.kitchenTabCountTextActive]}>{counts[item]}</Text></View>
              </Pressable>
            );
          })}
        </View>

        {error && (
          <Pressable style={styles.kitchenError} onPress={() => setError(null)}>
            <Ionicons name="alert-circle" size={19} color="#A84F37" />
            <Text style={styles.kitchenErrorText}>{error}</Text>
            <Ionicons name="close" size={17} color="#8D6A60" />
          </Pressable>
        )}

        {activeOrders === undefined ? (
          <View style={styles.kitchenEmpty}>
            <ActivityIndicator size="large" color="#A84629" />
            <Text style={styles.kitchenEmptyTitle}>Connecting to the kitchen…</Text>
            <Text style={styles.kitchenEmptyCopy}>Orders will appear here automatically.</Text>
          </View>
        ) : visibleOrders.length === 0 ? (
          <View style={styles.kitchenEmpty}>
            <View style={styles.kitchenEmptyIcon}><Ionicons name={status === "ready" ? "checkmark-done" : "restaurant-outline"} size={32} color="#678064" /></View>
            <Text style={styles.kitchenEmptyTitle}>{status === "new" ? "No new orders" : status === "preparing" ? "Nothing cooking" : "Nothing waiting for pickup"}</Text>
            <Text style={styles.kitchenEmptyCopy}>{status === "new" ? "New POS orders will appear instantly." : status === "preparing" ? "Start a new order when the kitchen is ready." : "Prepared orders will appear here."}</Text>
          </View>
        ) : (
          <View style={styles.kitchenList}>
            {visibleOrders.map((order) => {
              const isLate = now - order.createdAt >= 15 * 60 * 1000 && order.status !== "ready";
              const isTransitioning = transitioningId === order._id;
              const nextStatus = order.status === "new" ? "preparing" : order.status === "preparing" ? "ready" : "completed";
              const actionLabel = order.status === "new" ? "Start cooking" : order.status === "preparing" ? "Mark ready" : "Handed over";
              return (
                <View key={order._id} style={[styles.kitchenTicket, order.status === "ready" && styles.kitchenTicketReady]}>
                  <View style={styles.ticketHeader}>
                    <View>
                      <Text style={styles.ticketNumber}>{order.number}</Text>
                      <View style={styles.ticketTypeRow}>
                        <Ionicons name={order.orderType === "takeaway" ? "bag-handle-outline" : "restaurant-outline"} size={15} color="#766E67" />
                        <Text style={styles.ticketType}>{order.orderType === "takeaway" ? "Takeaway" : "Dine in"}</Text>
                      </View>
                    </View>
                    <View style={[styles.ticketTime, isLate && styles.ticketTimeLate, order.status === "ready" && styles.ticketTimeReady]}>
                      <Ionicons name="time-outline" size={16} color={isLate ? "#A33F28" : order.status === "ready" ? "#426944" : "#745E51"} />
                      <Text style={[styles.ticketTimeText, isLate && styles.ticketTimeTextLate, order.status === "ready" && styles.ticketTimeTextReady]}>{formatElapsed(order.createdAt, now)}</Text>
                    </View>
                  </View>

                  <View style={styles.ticketItems}>
                    {order.items.map((item) => (
                      <View key={item.key} style={styles.ticketItemRow}>
                        <View style={styles.ticketQuantity}><Text style={styles.ticketQuantityText}>{item.quantity}×</Text></View>
                        <Text style={styles.ticketItemName}>{item.name}</Text>
                      </View>
                    ))}
                  </View>

                  <Pressable
                    style={[styles.kitchenAction, order.status === "ready" && styles.kitchenActionReady, isTransitioning && styles.sendButtonDisabled]}
                    onPress={() => moveOrder(order._id, nextStatus)}
                    disabled={!!transitioningId}
                  >
                    {isTransitioning ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.kitchenActionText}>{actionLabel}</Text><Ionicons name={order.status === "ready" ? "checkmark-done" : "arrow-forward"} size={19} color="#FFFFFF" /></>}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function formatElapsed(createdAt: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function QuickAction({ label, icon, primary, onPress }: { label: string; icon: IconName; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.quickAction} onPress={onPress}>
      <View style={[styles.quickIcon, primary && styles.quickIconPrimary]}>
        <Ionicons name={icon} size={23} color={primary ? "#FFFFFF" : "#8F482F"} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({ title, badge, action, onAction }: { title: string; badge: string; action: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitleNoMargin}>{title}</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{badge}</Text></View>
      </View>
      <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable>
    </View>
  );
}

function EmptyScreen({ tab }: { tab: TabName }) {
  const icons: Record<TabName, IconName> = { Home: "home", Sell: "bag-handle", Kitchen: "restaurant", Stock: "cube", More: "grid" };
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icons[tab]} size={31} color="#A1472D" /></View>
      <Text style={styles.emptyTitle}>{tab}</Text>
      <Text style={styles.emptyCopy}>This mobile workflow is the next part of the Nectar build.</Text>
    </View>
  );
}

function TabBar({ tab, onChange, bottomInset, role }: { tab: TabName; onChange: (tab: TabName) => void; bottomInset: number; role: Role }) {
  const visibleTabs = role === "kitchen"
    ? tabs.filter((item) => ["Home", "Kitchen", "More"].includes(item.label))
    : role === "cashier"
      ? tabs.filter((item) => item.label !== "Stock")
      : tabs;
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(bottomInset, 8) }]}> 
      {visibleTabs.map((item) => {
        const active = item.label === tab;
        const sell = item.label === "Sell";
        return (
          <Pressable key={item.label} style={styles.tabItem} onPress={() => onChange(item.label)}>
            <View style={sell ? styles.sellButton : styles.tabIconWrap}>
              <Ionicons name={active ? item.activeIcon : item.icon} size={sell ? 27 : 22} color={sell ? "#FFFFFF" : active ? "#A1472D" : "#8A827C"} />
            </View>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFF9F2" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 126 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  eyebrow: { color: "#8C8177", fontSize: 12, fontWeight: "700", letterSpacing: 0.75 },
  greeting: { color: "#2F241D", fontSize: 28, fontWeight: "700", letterSpacing: -0.7, marginTop: 6 },
  salesCard: { minHeight: 245, justifyContent: "flex-end", overflow: "hidden", borderRadius: 25, padding: 20, shadowColor: "#4B2518", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 5 },
  salesCardImage: { borderRadius: 25 },
  salesOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(36, 18, 10, 0.45)" },
  salesTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  salesLabel: { color: "#F8E4D5", fontSize: 12, fontWeight: "800", letterSpacing: 0.9 },
  salesValue: { color: "#FFFFFF", fontSize: 38, fontWeight: "700", letterSpacing: -1.1, marginTop: 7 },
  trendPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F8E2A4", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  trendText: { color: "#543419", fontSize: 13, fontWeight: "800" },
  chartRow: { height: 61, flexDirection: "row", alignItems: "flex-end", gap: 5, marginTop: 16 },
  chartBar: { flex: 1, borderRadius: 4, backgroundColor: "#729078" },
  salesFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  salesHint: { color: "#F5E9E1", fontSize: 14 },
  salesLink: { color: "#FFD67A", fontSize: 14, fontWeight: "700" },
  statRow: { flexDirection: "row", gap: 11, marginTop: 12 },
  statCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 19, padding: 15, borderWidth: 1, borderColor: "#ECEAE4" },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  statLabel: { color: "#7D7771", fontSize: 13, fontWeight: "600" },
  statValue: { color: "#31261F", fontSize: 21, fontWeight: "700", letterSpacing: -0.4, marginTop: 5 },
  sectionTitle: { color: "#33271F", fontSize: 21, fontWeight: "700", letterSpacing: -0.3, marginTop: 30, marginBottom: 16 },
  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  quickAction: { width: "23%", alignItems: "center" },
  quickIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: "#E9EEE6", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#DEE5DA" },
  quickIconPrimary: { backgroundColor: "#B94F2C", borderColor: "#B94F2C" },
  quickLabel: { color: "#514942", fontSize: 13, fontWeight: "600", lineHeight: 17, textAlign: "center", marginTop: 9 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 30, marginBottom: 12 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitleNoMargin: { color: "#33271F", fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  countBadge: { backgroundColor: "#EEEDE7", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  countText: { color: "#74706B", fontSize: 12, fontWeight: "700" },
  sectionAction: { color: "#A84B2D", fontSize: 14, fontWeight: "700" },
  groupedList: { backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: 1, borderColor: "#ECEAE4", paddingHorizontal: 14, overflow: "hidden" },
  attentionItem: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E6E5DF" },
  attentionIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  attentionCopy: { flex: 1 },
  itemTitle: { color: "#312923", fontSize: 16, fontWeight: "700" },
  itemMeta: { color: "#817B75", fontSize: 13, marginTop: 5 },
  allClearCard: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: 1, borderColor: "#DCE7D8", paddingHorizontal: 15 },
  allClearIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#E4EFE1", alignItems: "center", justifyContent: "center" },
  orderList: { gap: 9 },
  orderCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", minHeight: 92, borderRadius: 19, borderWidth: 1, borderColor: "#ECEAE4", padding: 15 },
  orderMain: { flex: 1 },
  orderHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  orderNumber: { color: "#352A23", fontSize: 16, fontWeight: "800" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: "800" },
  orderItems: { color: "#726A64", fontSize: 14, lineHeight: 20, marginTop: 9 },
  timeBlock: { width: 47, alignItems: "flex-end", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: "#E0DFD9", marginLeft: 10 },
  timeValue: { color: "#30352F", fontSize: 18, fontWeight: "800" },
  timeUnit: { color: "#908A84", fontSize: 12, marginTop: 1 },
  posScreen: { flex: 1, backgroundColor: "#FFF9F2" },
  posContent: { paddingHorizontal: 18, paddingTop: 8 },
  posHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },
  posTitle: { color: "#33251D", fontSize: 32, fontWeight: "700", letterSpacing: -0.9, marginTop: 5 },
  historyButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: "#E7EDE4", alignItems: "center", justifyContent: "center" },
  historyBadge: { position: "absolute", top: -5, right: -5, minWidth: 21, height: 21, borderRadius: 11, backgroundColor: "#C54F2D", borderWidth: 2, borderColor: "#FFF9F2", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  historyBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  posMessage: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 15, backgroundColor: "#E8F2E5", marginBottom: 13 },
  posMessageError: { backgroundColor: "#FAE9E3" },
  posMessageText: { flex: 1, color: "#465047", fontSize: 14, lineHeight: 19, fontWeight: "700" },
  searchBox: { height: 54, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 17, borderWidth: 1, borderColor: "#E4DDD5", paddingHorizontal: 14 },
  searchInput: { flex: 1, color: "#342A24", fontSize: 16, paddingVertical: 0 },
  categoryRow: { gap: 8, paddingTop: 14, paddingBottom: 6 },
  categoryChip: { paddingHorizontal: 17, paddingVertical: 11, borderRadius: 20, backgroundColor: "#F0E8DF" },
  categoryChipActive: { backgroundColor: "#A84629" },
  categoryText: { color: "#6C6058", fontSize: 14, fontWeight: "700" },
  categoryTextActive: { color: "#FFFFFF" },
  menuHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 12 },
  menuHeadingText: { color: "#33271F", fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  menuCount: { color: "#817A74", fontSize: 13, fontWeight: "600" },
  menuList: { gap: 10 },
  menuRow: { minHeight: 105, flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: "#FFFFFF", borderRadius: 19, borderWidth: 1, borderColor: "#E9E0D8", padding: 11 },
  menuThumb: { width: 78, height: 78, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  menuCopy: { flex: 1 },
  menuName: { color: "#382D26", fontSize: 16, lineHeight: 21, fontWeight: "800" },
  menuDescription: { color: "#877E77", fontSize: 13, lineHeight: 18, marginTop: 3 },
  menuPrice: { color: "#A1462B", fontSize: 15, fontWeight: "800", marginTop: 7 },
  addButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: "#F4E6DC", alignItems: "center", justifyContent: "center" },
  addButtonActive: { backgroundColor: "#A84629" },
  addButtonQuantity: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  soldOutButton: { borderRadius: 10, backgroundColor: "#A34A30", paddingHorizontal: 10, paddingVertical: 7, alignItems: "center", justifyContent: "center" },
  soldOutText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  noResults: { alignItems: "center", paddingTop: 65 },
  noResultsTitle: { color: "#555B54", fontSize: 15, fontWeight: "700", marginTop: 12 },
  noResultsCopy: { color: "#92968F", fontSize: 14, marginTop: 5 },
  cartDock: { position: "absolute", left: 18, right: 18, minHeight: 72, flexDirection: "row", alignItems: "center", borderRadius: 21, backgroundColor: "#873D27", paddingHorizontal: 14, shadowColor: "#4A1B10", shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 9 },
  cartCount: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#FFD279", alignItems: "center", justifyContent: "center" },
  cartCountText: { color: "#63301F", fontSize: 15, fontWeight: "900" },
  cartDockCopy: { flex: 1, marginLeft: 11 },
  cartDockLabel: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  cartDockMeta: { color: "#F0CEC1", fontSize: 12, marginTop: 3 },
  cartDockTotal: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginRight: 6 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(19, 25, 20, 0.48)" },
  cartSheet: { maxHeight: "91%", backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  historySheet: { maxHeight: "84%", minHeight: 420, backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  historyTabs: { flexDirection: "row", backgroundColor: "#EDE5DC", borderRadius: 15, padding: 4, marginBottom: 13 },
  historyTab: { flex: 1, height: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12 },
  historyTabActive: { backgroundColor: "#FFFFFF", shadowColor: "#4B3024", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  historyTabText: { color: "#786D65", fontSize: 14, fontWeight: "700" },
  historyTabTextActive: { color: "#8E4029", fontWeight: "900" },
  historyTabBadge: { minWidth: 21, height: 21, borderRadius: 11, backgroundColor: "#F1DED4", alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  historyTabBadgeText: { color: "#9C442D", fontSize: 11, fontWeight: "900" },
  historyList: { maxHeight: 470 },
  historyEmpty: { minHeight: 235, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  historyEmptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: "#E4EFE1", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  historyEmptyTitle: { color: "#3C342F", fontSize: 18, fontWeight: "800" },
  historyEmptyCopy: { color: "#847C76", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 7 },
  unpaidRow: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E9E0D8", borderRadius: 18, padding: 13, marginBottom: 10 },
  unpaidIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#F5E6DC", alignItems: "center", justifyContent: "center" },
  unpaidMain: { flex: 1 },
  unpaidNumber: { color: "#382D26", fontSize: 17, fontWeight: "800" },
  unpaidMeta: { color: "#80776F", fontSize: 13, marginTop: 6 },
  unpaidRight: { alignItems: "flex-end" },
  unpaidAmount: { color: "#332820", fontSize: 16, fontWeight: "900" },
  unpaidPay: { color: "#A84629", fontSize: 13, fontWeight: "800", marginTop: 7 },
  orderHistoryRow: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E9E0D8", borderRadius: 18, padding: 13, marginBottom: 10 },
  orderHistoryTop: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12 },
  orderHistoryHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  orderStatusBadge: { backgroundColor: "#F4E6D7", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3 },
  orderStatusBadgeText: { color: "#946038", fontSize: 10, fontWeight: "900" },
  orderStatusCancelled: { backgroundColor: "#F4DFD9" },
  orderStatusCancelledText: { color: "#A34A35" },
  orderStatusReady: { backgroundColor: "#E3EFE0" },
  orderStatusReadyText: { color: "#4F744D" },
  orderPaymentState: { color: "#A34A31", fontSize: 12, fontWeight: "800", marginTop: 6 },
  orderPaymentPaid: { color: "#4F744D" },
  orderHistoryActions: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E5DED8" },
  orderPayButton: { flex: 1, height: 42, borderRadius: 12, backgroundColor: "#A84629", alignItems: "center", justifyContent: "center" },
  orderPayButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  orderCancelButton: { flex: 1, height: 42, borderRadius: 12, backgroundColor: "#F5E5DF", alignItems: "center", justifyContent: "center" },
  orderCancelButtonText: { color: "#9B4932", fontSize: 13, fontWeight: "900" },
  orderRefundButton: { flex: 1, height: 42, borderRadius: 12, backgroundColor: "#F0E7D2", alignItems: "center", justifyContent: "center" },
  orderRefundButtonText: { color: "#8A6427", fontSize: 13, fontWeight: "900" },
  paymentSheet: { backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  cancelSheet: { backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  cancelChoice: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 17, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#E6DED7", padding: 12, marginBottom: 10 },
  cancelChoiceActive: { borderColor: "#B85B3D", backgroundColor: "#FFFCF8" },
  cancelChoiceIcon: { width: 47, height: 47, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  cancelChoiceMain: { flex: 1 },
  cancelChoiceTitle: { color: "#3C312B", fontSize: 15, fontWeight: "900" },
  cancelChoiceCopy: { color: "#81776F", fontSize: 12, lineHeight: 17, marginTop: 5 },
  cancelConfirmButton: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 17, backgroundColor: "#98462F", marginTop: 6 },
  refundSheet: { backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  refundWarning: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#F8EDD8", borderRadius: 14, padding: 11, marginBottom: 18 },
  refundWarningText: { flex: 1, color: "#81612E", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  reasonInputWrap: { minHeight: 54, justifyContent: "center", borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#D8CDC4", paddingHorizontal: 14, marginBottom: 15 },
  reasonInput: { color: "#342820", fontSize: 15, paddingVertical: 8 },
  refundConfirmButton: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 17, backgroundColor: "#8B6428" },
  moreScreen: { flex: 1, backgroundColor: "#FFF9F2" },
  moreContent: { paddingHorizontal: 18, paddingTop: 8 },
  moreHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  moreTitle: { color: "#33251D", fontSize: 31, fontWeight: "800", letterSpacing: -0.8, marginTop: 5 },
  moreIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#F4E3DA", alignItems: "center", justifyContent: "center" },
  moreIntro: { color: "#817870", fontSize: 15, lineHeight: 21, marginBottom: 18 },
  roleBanner: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#EAF0E6", borderRadius: 14, paddingHorizontal: 12, marginBottom: 13 },
  roleBannerText: { flex: 1, color: "#526D4D", fontSize: 14, fontWeight: "800" },
  roleChangeText: { color: "#A1472D", fontSize: 13, fontWeight: "900", padding: 7 },
  moreTabs: { flexDirection: "row", backgroundColor: "#EDE5DC", borderRadius: 16, padding: 4, marginBottom: 14 },
  moreTab: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  moreTabActive: { backgroundColor: "#FFFFFF", shadowColor: "#4B3024", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  moreTabText: { color: "#786D65", fontSize: 13, fontWeight: "700" },
  moreTabTextActive: { color: "#8E4029", fontWeight: "900" },
  shiftCard: { minHeight: 87, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFFFFF", borderRadius: 19, borderWidth: 1, borderColor: "#DDE7D9", padding: 12, marginBottom: 12 },
  shiftCardIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#E6EFE2", alignItems: "center", justifyContent: "center" },
  shiftCardMain: { flex: 1 },
  shiftCardTitle: { color: "#3B312B", fontSize: 15, fontWeight: "900" },
  shiftCardCopy: { color: "#827970", fontSize: 12, lineHeight: 17, marginTop: 4 },
  shiftButton: { height: 39, minWidth: 58, borderRadius: 12, backgroundColor: "#A84629", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  shiftButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  shiftCloseButton: { backgroundColor: "#F4E3DB" },
  shiftCloseButtonText: { color: "#A34A30" },
  shiftBreakdown: { backgroundColor: "#F4F5F0", borderRadius: 17, paddingHorizontal: 15, paddingVertical: 12, marginBottom: 15, gap: 9 },
  shiftBreakdownRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shiftBreakdownLabel: { color: "#6E756C", fontSize: 13, fontWeight: "600" },
  shiftBreakdownValue: { color: "#3B322C", fontSize: 14, fontWeight: "800" },
  shiftBreakdownTotalRow: { borderTopWidth: 1, borderTopColor: "#E2E4DC", paddingTop: 10 },
  shiftBreakdownTotalLabel: { color: "#3F5F40", fontSize: 13, fontWeight: "900" },
  shiftBreakdownTotalValue: { color: "#3F5F40", fontSize: 17, fontWeight: "900" },
  moneySummaryCard: { backgroundColor: "#7C3A27", borderRadius: 22, padding: 17, marginBottom: 13 },
  moneySummaryHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  moneySummaryEyebrow: { color: "#F1D5C8", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  moneySummaryTotal: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", letterSpacing: -0.5, marginTop: 6 },
  moneySummaryCaption: { color: "#EFCFC2", fontSize: 12, marginTop: 3 },
  moneySummaryIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  moneySummaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.24)", marginVertical: 15 },
  moneySummaryGrid: { flexDirection: "row", justifyContent: "space-between" },
  moneyMetricLabel: { color: "#EFCFC2", fontSize: 12, fontWeight: "600" },
  moneyMetricValue: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", marginTop: 4 },
  moneyCostRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 17 },
  moneyCostLabel: { color: "#F2D9CF", fontSize: 11, fontWeight: "700" },
  moneyActionRow: { flexDirection: "row", gap: 10 },
  moneyAction: { flex: 1, minHeight: 142, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E8DED6", borderRadius: 19, padding: 13 },
  moneyActionIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  moneyActionTitle: { color: "#3A302A", fontSize: 15, fontWeight: "900" },
  moneyActionCopy: { color: "#877D75", fontSize: 12, lineHeight: 17, marginTop: 5 },
  moreSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 27, marginBottom: 11 },
  weekCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 15, marginBottom: 8 },
  weekChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 104, marginBottom: 13 },
  weekBarColumn: { flex: 1, alignItems: "center", gap: 6 },
  weekBarTrack: { width: 22, height: 84, borderRadius: 11, backgroundColor: "#F1F2EC", justifyContent: "flex-end", overflow: "hidden" },
  weekBarFill: { width: "100%", borderRadius: 11, backgroundColor: "#557451" },
  weekBarLabel: { color: "#9A9F96", fontSize: 11, fontWeight: "700" },
  weekTotals: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#EEEFE8", paddingTop: 12 },
  weekTotalBlock: { flex: 1, gap: 3 },
  rankBadge: { width: 25, height: 25, borderRadius: 13, backgroundColor: "#F2E9CB", alignItems: "center", justifyContent: "center" },
  rankText: { color: "#8A702D", fontSize: 13, fontWeight: "900" },
  rankQty: { color: "#3B322C", fontSize: 16, fontWeight: "900" },
  reportPeriodRow: { flexDirection: "row", gap: 8, marginBottom: 11 },
  reportPeriodChip: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 13, backgroundColor: "#F1F2EC" },
  reportPeriodChipActive: { backgroundColor: "#557451" },
  reportPeriodText: { color: "#6E756C", fontSize: 13, fontWeight: "800" },
  reportPeriodTextActive: { color: "#FFFFFF" },
  reportCard: { backgroundColor: "#FFFFFF", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8, gap: 10 },
  reportDivider: { height: 1, backgroundColor: "#EEEFE8", marginVertical: 2 },
  moreSectionTitle: { color: "#382C25", fontSize: 20, fontWeight: "800" },
  moreSectionHint: { color: "#8A817A", fontSize: 12, fontWeight: "600" },
  moneyList: { backgroundColor: "#FFFFFF", borderRadius: 19, borderWidth: 1, borderColor: "#E8DED6", paddingHorizontal: 13, overflow: "hidden" },
  moneyListRow: { minHeight: 69, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E6E0DA" },
  moneyListIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#F7E4DC", alignItems: "center", justifyContent: "center" },
  moneyListMain: { flex: 1 },
  moneyListTitle: { color: "#3B312B", fontSize: 14, fontWeight: "800" },
  moneyListMeta: { color: "#8B8179", fontSize: 12, marginTop: 4 },
  moneyListAmount: { color: "#3C332D", fontSize: 15, fontWeight: "900" },
  moreEmpty: { minHeight: 58, justifyContent: "center", paddingHorizontal: 15, backgroundColor: "#FFFFFF", borderRadius: 17, borderWidth: 1, borderColor: "#E8DED6" },
  moreEmptyText: { color: "#887E76", fontSize: 14 },
  moneySheet: { maxHeight: "88%", backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  roleSheet: { backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  roleOption: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1.5, borderColor: "#E8DED6", backgroundColor: "#FFFFFF", paddingHorizontal: 12, marginBottom: 9 },
  roleOptionActive: { borderColor: "#B85B3D", backgroundColor: "#FFFCF8" },
  roleOptionIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: "#F4EAE1", alignItems: "center", justifyContent: "center" },
  roleOptionMain: { flex: 1 },
  roleOptionTitle: { color: "#3C312B", fontSize: 15, fontWeight: "900" },
  roleOptionCopy: { color: "#81776F", fontSize: 12, lineHeight: 16, marginTop: 4 },
  signOutButton: { minHeight: 51, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, borderWidth: 1.5, borderColor: "#E7D6CD", backgroundColor: "#FAF1EA", marginTop: 8 },
  signOutText: { color: "#A84629", fontSize: 15, fontWeight: "900" },
  ingredientPicker: { gap: 8, paddingBottom: 17 },
  ingredientChip: { borderRadius: 14, backgroundColor: "#EFE7DF", paddingHorizontal: 13, paddingVertical: 10 },
  ingredientChipActive: { backgroundColor: "#A84629" },
  ingredientChipText: { color: "#756A62", fontSize: 13, fontWeight: "800" },
  ingredientChipTextActive: { color: "#FFFFFF" },
  purchaseFieldRow: { flexDirection: "row", gap: 10, marginTop: 2, marginBottom: 14 },
  moneySheetScroll: { flexGrow: 0, maxHeight: "80%" },
  addLineButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "#BFD3B8", backgroundColor: "#F1F6EE", marginBottom: 14 },
  addLineText: { color: "#557451", fontSize: 14, fontWeight: "800" },
  purchaseLinesList: { gap: 8, marginBottom: 14 },
  purchaseLineRow: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  purchaseLineMain: { flex: 1 },
  purchaseLineName: { color: "#3B322C", fontSize: 14, fontWeight: "800" },
  purchaseLineMeta: { color: "#887E76", fontSize: 12, marginTop: 2 },
  purchaseLineTotal: { color: "#3B322C", fontSize: 14, fontWeight: "900" },
  purchaseLineBlock: { gap: 6 },
  lineActions: { flexDirection: "row", alignItems: "center", gap: 14, marginLeft: 4 },
  lineEditActions: { alignItems: "flex-end", gap: 8 },
  lineSaveButton: { minHeight: 40, paddingHorizontal: 18, borderRadius: 13, backgroundColor: "#557451", alignItems: "center", justifyContent: "center" },
  lineSaveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  lineCancelText: { color: "#887E76", fontSize: 13, fontWeight: "800" },
  lineConfirmStrip: { backgroundColor: "#FBEDE7", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, gap: 8 },
  lineConfirmActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16 },
  lineRemoveButton: { minHeight: 38, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#A34A30", alignItems: "center", justifyContent: "center" },
  lineRemoveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  purchaseDetailTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F1F6EE", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 13, marginTop: 2 },
  purchaseDetailTotal: { color: "#3B322C", fontSize: 16, fontWeight: "900" },
  removePurchaseLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 46, marginTop: 14 },
  removePurchaseText: { color: "#A34A30", fontSize: 14, fontWeight: "800" },
  detailActionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  detailCancelButton: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#F0EAE3" },
  detailCancelText: { color: "#4D534D", fontSize: 14, fontWeight: "800" },
  detailRemoveButton: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#A34A30" },
  detailRemoveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  lockedNotice: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  manageMenuButton: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E8DED6", padding: 12 },
  manageMenuIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: "#F4E3DA", alignItems: "center", justifyContent: "center" },
  manageMenuMain: { flex: 1 },
  menuManagerSheet: { maxHeight: "90%", backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  menuEditorScroll: { flexGrow: 0, maxHeight: "78%" },
  categorySelect: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, borderColor: "#E8DED6", backgroundColor: "#FFFFFF", paddingHorizontal: 14, marginBottom: 14 },
  categorySelectText: { color: "#3C312B", fontSize: 15, fontWeight: "700" },
  categoryPlaceholder: { color: "#A0A49D", fontWeight: "500" },
  categoryOptions: { borderRadius: 14, borderWidth: 1, borderColor: "#E8DED6", backgroundColor: "#FFFFFF", marginTop: -8, marginBottom: 14, overflow: "hidden" },
  categoryOption: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E4DDD7" },
  menuAddButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, backgroundColor: "#A84629", marginBottom: 10 },
  menuManagerList: { maxHeight: 520 },
  menuManagerRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E4DDD7" },
  menuManagerIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: "#F4E3DA", alignItems: "center", justifyContent: "center" },
  availabilityToggle: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 48, marginBottom: 12 },
  availabilityText: { color: "#4B5E4A", fontSize: 14, fontWeight: "800" },
  recipeTitle: { color: "#382C25", fontSize: 19, fontWeight: "800", marginTop: 21, marginBottom: 8 },
  recipeRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E4DDD7" },
  recipeName: { flex: 1, color: "#4A4039", fontSize: 14, fontWeight: "700" },
  recipeQuantity: { color: "#756A62", fontSize: 13, fontWeight: "700" },
  recipeAddRow: { marginTop: 10 },
  addRecipeButton: { width: 46, height: 46, borderRadius: 13, backgroundColor: "#A84629", alignItems: "center", justifyContent: "center", marginTop: 8 },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: "#CFD0CA", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  sheetTitle: { color: "#342820", fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  sheetSubtitle: { color: "#817A74", fontSize: 14, marginTop: 4 },
  sheetClose: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#EDEDE7", alignItems: "center", justifyContent: "center" },
  orderTypeControl: { flexDirection: "row", backgroundColor: "#EDEDE7", borderRadius: 15, padding: 4, marginBottom: 12 },
  orderTypeOption: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12 },
  orderTypeActive: { backgroundColor: "#A84629" },
  orderTypeText: { color: "#6E665F", fontSize: 14, fontWeight: "700" },
  orderTypeTextActive: { color: "#FFFFFF" },
  takeawayFees: { flexDirection: "row", gap: 10, marginBottom: 12 },
  feeField: { flex: 1 },
  feeLabel: { color: "#716A64", fontSize: 13, fontWeight: "700", marginBottom: 7 },
  moneyInputWrap: { height: 48, flexDirection: "row", alignItems: "center", borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DED5CE", paddingHorizontal: 11 },
  moneyPrefix: { color: "#5A514B", fontSize: 15, fontWeight: "800", marginRight: 3 },
  moneyInput: { flex: 1, color: "#352B25", fontSize: 16, fontWeight: "700", paddingVertical: 0 },
  cartLines: { maxHeight: 300 },
  cartLine: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DDDCD6" },
  cartLineIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cartLineMain: { flex: 1 },
  cartLineTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cartLineNameWrap: { flex: 1 },
  cartLineName: { color: "#382D26", fontSize: 15, fontWeight: "700" },
  cartLinePrice: { color: "#7C746E", fontSize: 13, marginTop: 4 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#ECE7E1", alignItems: "center", justifyContent: "center" },
  stepButtonAdd: { backgroundColor: "#A84629" },
  stepValue: { minWidth: 18, color: "#39302A", fontSize: 17, fontWeight: "800", textAlign: "center" },
  totalsBlock: { paddingTop: 12, paddingBottom: 12 },
  subtotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  subtotalLabel: { color: "#817A74", fontSize: 13 },
  subtotalValue: { color: "#5E554F", fontSize: 13, fontWeight: "700" },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#D8D8D2" },
  totalLabel: { color: "#6B625C", fontSize: 15, fontWeight: "700" },
  totalValue: { color: "#352820", fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  sendButton: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 17, backgroundColor: "#A84629" },
  sendButtonDisabled: { opacity: 0.65 },
  sendButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  paymentHero: { alignItems: "center", justifyContent: "center", backgroundColor: "#F0E6D9", borderRadius: 20, paddingVertical: 21, marginBottom: 20 },
  paymentTotalLabel: { color: "#856F62", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  paymentTotal: { color: "#34261E", fontSize: 35, fontWeight: "900", letterSpacing: -0.9, marginTop: 7 },
  paymentPaidHint: { color: "#5E7A59", fontSize: 13, fontWeight: "700", marginTop: 4 },
  paymentSectionLabel: { color: "#665B54", fontSize: 14, fontWeight: "800", marginBottom: 9 },
  methodRow: { flexDirection: "row", gap: 8, marginBottom: 19 },
  methodOption: { flex: 1, minHeight: 60, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 15, backgroundColor: "#EFE7DF", borderWidth: 1, borderColor: "#E3D8CE" },
  methodOptionActive: { backgroundColor: "#8D3E27", borderColor: "#8D3E27" },
  methodText: { color: "#655A53", fontSize: 13, fontWeight: "800" },
  methodTextActive: { color: "#FFFFFF" },
  cashBlock: { marginBottom: 15 },
  cashInputWrap: { height: 60, flexDirection: "row", alignItems: "center", borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#D8CDC4", paddingHorizontal: 15 },
  cashPrefix: { color: "#5D514A", fontSize: 21, fontWeight: "900", marginRight: 5 },
  cashInput: { flex: 1, color: "#342820", fontSize: 22, fontWeight: "800", paddingVertical: 0 },
  changeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 11, paddingHorizontal: 2 },
  changeLabel: { color: "#777069", fontSize: 14, fontWeight: "600" },
  changeAmount: { color: "#4D7651", fontSize: 17, fontWeight: "900" },
  paymentErrorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FAE7E0", borderRadius: 13, padding: 11, marginBottom: 12 },
  paymentErrorText: { flex: 1, color: "#91442F", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  paymentNoticeBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E6F0E2", borderRadius: 13, padding: 11, marginBottom: 12 },
  paymentNoticeText: { flex: 1, color: "#4D704C", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  splitHint: { color: "#817870", fontSize: 12, lineHeight: 17, marginTop: 7 },
  payLaterButton: { height: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  payLaterText: { color: "#7B6E66", fontSize: 15, fontWeight: "800" },
  receiptContent: { paddingBottom: 4 },
  receiptIcon: { width: 68, height: 68, borderRadius: 24, backgroundColor: "#587A55", alignSelf: "center", alignItems: "center", justifyContent: "center", marginTop: 5 },
  receiptTitle: { color: "#342820", fontSize: 27, fontWeight: "900", textAlign: "center", letterSpacing: -0.5, marginTop: 16 },
  receiptSubtitle: { color: "#817870", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 6 },
  receiptCard: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E7DED6", paddingHorizontal: 15, paddingVertical: 6, marginTop: 20, marginBottom: 17 },
  receiptRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E2DDD7" },
  receiptLabel: { color: "#7B736C", fontSize: 14 },
  receiptValue: { color: "#3A302A", fontSize: 15, fontWeight: "800" },
  changeValue: { color: "#4D7651" },
  kitchenScreen: { flex: 1, backgroundColor: "#FFF9F2" },
  kitchenContent: { paddingHorizontal: 18, paddingTop: 8 },
  kitchenHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  kitchenTitle: { color: "#33251D", fontSize: 31, fontWeight: "800", letterSpacing: -0.8, marginTop: 5 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#E5EFE1", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#5E8B58" },
  liveText: { color: "#4C704A", fontSize: 13, fontWeight: "800" },
  kitchenSummary: { minHeight: 108, flexDirection: "row", alignItems: "center", gap: 19, overflow: "hidden", backgroundColor: "#7D3825", borderRadius: 22, paddingHorizontal: 18, marginBottom: 15 },
  kitchenSummaryValue: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", letterSpacing: -0.5 },
  kitchenSummaryLabel: { color: "#F1D5C8", fontSize: 13, fontWeight: "600", marginTop: 3 },
  kitchenSummaryDivider: { width: StyleSheet.hairlineWidth, height: 48, backgroundColor: "rgba(255,255,255,0.28)" },
  kitchenSummaryArt: { position: "absolute", right: -10, bottom: -14, width: 74, height: 74, borderRadius: 30, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  kitchenTabs: { flexDirection: "row", backgroundColor: "#EDE5DC", borderRadius: 17, padding: 4, marginBottom: 14 },
  kitchenTab: { flex: 1, minHeight: 49, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 14 },
  kitchenTabActive: { backgroundColor: "#FFFFFF", shadowColor: "#4B3024", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  kitchenTabText: { color: "#796D65", fontSize: 14, fontWeight: "700" },
  kitchenTabTextActive: { color: "#8F3F27", fontWeight: "900" },
  kitchenTabCount: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#DDD2C8", paddingHorizontal: 5 },
  kitchenTabCountActive: { backgroundColor: "#F1DFD5" },
  kitchenTabCountText: { color: "#74685F", fontSize: 11, fontWeight: "900" },
  kitchenTabCountTextActive: { color: "#9D452B" },
  kitchenError: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 15, backgroundColor: "#FAE7E0", marginBottom: 12 },
  kitchenErrorText: { flex: 1, color: "#8F4530", fontSize: 14, lineHeight: 19, fontWeight: "700" },
  kitchenEmpty: { minHeight: 330, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  kitchenEmptyIcon: { width: 70, height: 70, borderRadius: 24, backgroundColor: "#E5EDE1", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  kitchenEmptyTitle: { color: "#423832", fontSize: 19, fontWeight: "800", textAlign: "center", marginTop: 15 },
  kitchenEmptyCopy: { color: "#857C75", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 7 },
  kitchenList: { gap: 12 },
  kitchenTicket: { backgroundColor: "#FFFFFF", borderRadius: 21, borderWidth: 1, borderColor: "#E8DED6", padding: 16, shadowColor: "#4B3024", shadowOpacity: 0.05, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  kitchenTicketReady: { borderColor: "#C8D9C2", backgroundColor: "#FBFFF9" },
  ticketHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5DED8" },
  ticketNumber: { color: "#362A23", fontSize: 23, fontWeight: "900", letterSpacing: -0.4 },
  ticketTypeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  ticketType: { color: "#766E67", fontSize: 14, fontWeight: "600" },
  ticketTime: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F1E8DF", borderRadius: 13, paddingHorizontal: 10, paddingVertical: 8 },
  ticketTimeLate: { backgroundColor: "#F9DFD6" },
  ticketTimeReady: { backgroundColor: "#E5F0E1" },
  ticketTimeText: { color: "#745E51", fontSize: 13, fontWeight: "800" },
  ticketTimeTextLate: { color: "#A33F28" },
  ticketTimeTextReady: { color: "#426944" },
  ticketItems: { paddingVertical: 8 },
  ticketItemRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 11 },
  ticketQuantity: { minWidth: 39, height: 34, borderRadius: 11, backgroundColor: "#F1E3D7", alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  ticketQuantityText: { color: "#8E3F29", fontSize: 15, fontWeight: "900" },
  ticketItemName: { flex: 1, color: "#3C332D", fontSize: 17, lineHeight: 23, fontWeight: "700" },
  kitchenAction: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 16, backgroundColor: "#A84629", marginTop: 3 },
  kitchenActionReady: { backgroundColor: "#567553" },
  kitchenActionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  stockScreen: { flex: 1, backgroundColor: "#FFF9F2" },
  stockContent: { paddingHorizontal: 18, paddingTop: 8 },
  stockHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  stockTitle: { color: "#33251D", fontSize: 31, fontWeight: "800", letterSpacing: -0.8, marginTop: 5 },
  stockCountPill: { minWidth: 58, height: 52, borderRadius: 17, backgroundColor: "#E6ECE1", alignItems: "center", justifyContent: "center" },
  stockCountValue: { color: "#4D6E4B", fontSize: 18, fontWeight: "900" },
  stockCountLabel: { color: "#71806E", fontSize: 11, fontWeight: "700", marginTop: 1 },
  stockOverview: { minHeight: 105, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 21, backgroundColor: "#7C3A27", padding: 16, marginBottom: 14 },
  stockOverviewIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  stockOverviewCopy: { flex: 1 },
  stockOverviewTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  stockOverviewText: { color: "#EFCFC2", fontSize: 13, lineHeight: 18, marginTop: 5 },
  stockListHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 23, marginBottom: 11 },
  stockListTitle: { color: "#382C25", fontSize: 21, fontWeight: "800" },
  stockListHint: { color: "#8A817A", fontSize: 12, fontWeight: "600" },
  stockAddButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#E7EFE4" },
  stockAddText: { color: "#557451", fontSize: 13, fontWeight: "800" },
  inactiveBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: "#EDE7E1" },
  inactiveBadgeText: { color: "#7C736C", fontSize: 11, fontWeight: "800" },
  sheetHeaderActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetEditButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#E7EFE4" },
  sheetEditText: { color: "#557451", fontSize: 13, fontWeight: "800" },
  dangerButton: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FBEDE7", borderRadius: 18, borderWidth: 1, borderColor: "#F0D4C7", padding: 13 },
  dangerIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#F7DED2", alignItems: "center", justifyContent: "center" },
  dangerTitle: { color: "#8F3B22", fontSize: 16, fontWeight: "800" },
  dangerCopy: { color: "#A56248", fontSize: 12, fontWeight: "600", marginTop: 2 },
  resetWarning: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "#FBEDE7", borderRadius: 14, padding: 12, marginBottom: 12 },
  resetWarningText: { flex: 1, color: "#8F3B22", fontSize: 13, fontWeight: "600", lineHeight: 19 },
  resetKeepText: { color: "#7C736C", fontSize: 12, fontWeight: "600", marginBottom: 14 },
  resetButton: { backgroundColor: "#A34A30" },
  stockList: { gap: 9 },
  stockRow: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E8DED6", padding: 12 },
  stockItemIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#E5EEE1", alignItems: "center", justifyContent: "center" },
  stockItemIconLow: { backgroundColor: "#F7E3DB" },
  stockItemMain: { flex: 1 },
  stockItemHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  stockItemName: { color: "#3A302A", fontSize: 16, fontWeight: "800" },
  stockItemMeta: { color: "#887F78", fontSize: 12, marginTop: 6 },
  lowBadge: { backgroundColor: "#F8E0D8", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3 },
  lowBadgeText: { color: "#A34830", fontSize: 10, fontWeight: "900" },
  stockQuantityBlock: { alignItems: "flex-end" },
  stockQuantity: { color: "#405841", fontSize: 19, fontWeight: "900" },
  stockQuantityLow: { color: "#A3452D" },
  stockUnit: { color: "#898079", fontSize: 11, marginTop: 2 },
  stockEmpty: { minHeight: 290, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  stockEmptyTitle: { color: "#423832", fontSize: 18, fontWeight: "800", textAlign: "center", marginTop: 14 },
  stockEmptyCopy: { color: "#857C75", fontSize: 14, textAlign: "center", marginTop: 7 },
  movementSection: { marginTop: 4 },
  movementList: { backgroundColor: "#FFFFFF", borderRadius: 19, borderWidth: 1, borderColor: "#E8DED6", paddingHorizontal: 13, overflow: "hidden" },
  movementRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11 },
  movementIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  movementIconPositive: { backgroundColor: "#E3EEE0" },
  movementIconNegative: { backgroundColor: "#F7E1D9" },
  movementMain: { flex: 1 },
  movementName: { color: "#3B312B", fontSize: 14, fontWeight: "800" },
  movementMeta: { color: "#897F78", fontSize: 12, marginTop: 4 },
  movementAmountWrap: { alignItems: "flex-end" },
  movementAmount: { fontSize: 15, fontWeight: "900" },
  movementAmountPositive: { color: "#4E744E" },
  movementAmountNegative: { color: "#A5472F" },
  movementUnit: { color: "#938A83", fontSize: 10, marginTop: 2 },
  receiveSheet: { backgroundColor: "#FFF9F2", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10 },
  currentStockCard: { alignItems: "center", backgroundColor: "#E8EFE4", borderRadius: 19, paddingVertical: 18, marginBottom: 19 },
  currentStockLabel: { color: "#70806D", fontSize: 11, fontWeight: "900", letterSpacing: 0.9 },
  currentStockValue: { color: "#3F5F40", fontSize: 31, fontWeight: "900", marginTop: 6 },
  currentStockUnit: { fontSize: 16, fontWeight: "700" },
  stockActionTabs: { flexDirection: "row", backgroundColor: "#EBE4DC", borderRadius: 15, padding: 4, marginBottom: 18 },
  stockActionTab: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  stockActionTabActive: { backgroundColor: "#FFFFFF", shadowColor: "#4B3024", shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  stockActionTabText: { color: "#776B63", fontSize: 14, fontWeight: "700" },
  stockActionTabTextActive: { color: "#934129", fontWeight: "900" },
  receiveLabel: { color: "#665B54", fontSize: 14, fontWeight: "800", marginBottom: 9 },
  receiveInputWrap: { height: 62, flexDirection: "row", alignItems: "center", borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#D8CDC4", paddingHorizontal: 15, marginBottom: 13 },
  receiveInput: { flex: 1, color: "#342820", fontSize: 23, fontWeight: "800", paddingVertical: 0 },
  receiveUnit: { color: "#766D66", fontSize: 15, fontWeight: "800" },
  wasteButton: { backgroundColor: "#9B4933" },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 74, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-around", backgroundColor: "#FFFFFF", paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DADBD5", shadowColor: "#1A211B", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: -5 }, elevation: 12 },
  authLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF9F2" },
  signInScreen: { flex: 1, justifyContent: "center", backgroundColor: "#FFF9F2", paddingHorizontal: 25 },
  signInContent: { width: "100%", maxWidth: 430, alignSelf: "center" },
  signInMark: { alignItems: "flex-start", marginBottom: 22 },
  installBanner: { position: "absolute", left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#F0E3D8", shadowColor: "#4B2518", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  installIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#FBEDE6", alignItems: "center", justifyContent: "center" },
  installTextWrap: { flex: 1 },
  installTitle: { color: "#33251D", fontSize: 15, fontWeight: "800" },
  installCopy: { color: "#8C8177", fontSize: 12, lineHeight: 16, marginTop: 2 },
  installButton: { backgroundColor: "#A84629", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  installButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  installClose: { padding: 2 },
  headerBrandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  signInTitle: { color: "#33251D", fontSize: 36, lineHeight: 43, fontWeight: "900", letterSpacing: -1, marginTop: 11 },
  signInCopy: { color: "#817870", fontSize: 16, lineHeight: 23, marginTop: 11, marginBottom: 25 },
  signInError: { color: "#A13F2D", fontSize: 14, lineHeight: 20, fontWeight: "700", marginBottom: 14 },
  signInButton: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#A84629", borderRadius: 17 },
  signInButtonDisabled: { opacity: 0.65 },
  signInButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  signInForgot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18 },
  signInForgotText: { color: "#8C8177", fontSize: 14, fontWeight: "700" },
  tabItem: { flex: 1, alignItems: "center", minHeight: 53 },
  tabIconWrap: { height: 29, alignItems: "center", justifyContent: "center" },
  sellButton: { width: 52, height: 52, borderRadius: 18, backgroundColor: "#A84629", alignItems: "center", justifyContent: "center", marginTop: -25, borderWidth: 4, borderColor: "#FFF9F2", shadowColor: "#5C2314", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  tabLabel: { color: "#7D7975", fontSize: 12, fontWeight: "600", marginTop: 3 },
  tabLabelActive: { color: "#9F4228", fontWeight: "800" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 45, paddingBottom: 74 },
  emptyIcon: { width: 70, height: 70, borderRadius: 24, backgroundColor: "#E4ECE1", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#222722", fontSize: 28, fontWeight: "700", marginTop: 18 },
  emptyCopy: { color: "#858880", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
});
