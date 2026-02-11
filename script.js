/**
 * SCHL LIVE SCORE - MOTEUR DE MATCH
 * Développé par Adrien KEIRSGIETER
 */

// --- CONFIGURATION ---
const supabaseUrl = 'https://rmfcixwuyltwpotijozd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZmNpeHd1eWx0d3BvdGlqb3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMjQyMzgsImV4cCI6MjA4NTYwMDIzOH0.IW9b7431_xQlM1rydhOO551QgIq3bVEOgM5KllSzfTs';
const MATCH_ID = '7d6708ba-b37c-4719-8aea-da68cf7d6147';
const ADMIN_SECRET = "coach2026"; 
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- VARIABLES GLOBALES ---
let matchData = null;       // Données du match (scores, noms équipes)
let activePenalties = [];   // Liste des exclusions 2min en cours
let teamPlayers = [];       // Liste des joueurs récupérée de Supabase
let pendingGoalTeam = null; // Temp pour savoir quelle équipe vient de marquer
let fullTimeline = [];      // Historique complet pour les calculs de stats

/**
 * INITIALISATION DE L'APPLICATION
 */
async function init() {
    // 1. Charger les données initiales (Match, Joueurs, Historique)
    const { data: m } = await supabaseClient.from('matches').select('*').eq('id', MATCH_ID).single();
    matchData = m;
    
    const { data: pList } = await supabaseClient.from('players').select('*').eq('match_id', MATCH_ID).order('number');
    teamPlayers = pList || [];

    const { data: tHistory } = await supabaseClient.from('timeline').select('*').eq('match_id', MATCH_ID).order('created_at', { ascending: true });
    
    if (tHistory) {
        document.getElementById('timeline-container').innerHTML = '';
        tHistory.forEach(event => addEventToUI(event));
    }

    // 2. Établir les connexions en temps réel (Realtime)
    supabaseClient.channel('match-live').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, p => { matchData = p.new; updateDOM(); }).subscribe();
    supabaseClient.channel('penalties-live').on('postgres_changes', { event: '*', schema: 'public', table: 'penalties' }, () => reloadPenalties()).subscribe();
    supabaseClient.channel('timeline-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'timeline' }, p => addEventToUI(p.new)).subscribe();

    // 3. Activer le mode admin si le secret est dans l'URL
    if (new URLSearchParams(window.location.search).get('admin') === ADMIN_SECRET) {
        document.getElementById('admin-panel').classList.remove('hidden');
        document.getElementById('timeline-container').classList.add('is-admin');
    }
    
    reloadPenalties();
    setInterval(refreshTimers, 100); // Mise à jour chrono chaque 100ms
    updateDOM();
}

/**
 * GESTION DE LA TIMELINE ET DES ÉVÉNEMENTS
 */
function addEventToUI(event) {
    // Sécurité anti-doublons
    if (fullTimeline.some(e => e.id === event.id)) return;
    fullTimeline.push(event);
    calculateStats(); // Recalcule les % et Top Buteurs

    const container = document.getElementById('timeline-container');
    const isAdmin = new URLSearchParams(window.location.search).get('admin') === ADMIN_SECRET;

    // Ne pas afficher les arrêts GB aux parents (seulement Admin)
    if (event.event_type === 'gk_save' && !isAdmin) return;

    if (container.innerText.includes("attente")) container.innerHTML = '';

    const isPeriod = event.event_type === 'period_change';
    const div = document.createElement('div');
    div.id = `event-${event.id}`;
    div.className = `flex items-center gap-4 p-4 rounded-2xl border mb-3 animate-event shadow-lg ${isPeriod ? 'bg-amber-500/20 border-amber-500/40 border-l-4 border-l-amber-500': 'glass-card'}`;
    
    let icon = "🤾", label = "", team = "";
    
    // Détermination de l'affichage selon le type d'événement
    if (event.event_type.includes('goal')) {
        team = event.event_type.includes('home') ? matchData.home_team : matchData.away_team;
        const buteurInfo = event.player_name ? ` de <span class="text-white font-bold">${event.player_name}</span>` : ` de <span class="text-slate-300 font-medium">${team}</span>`;
        label = `<span class="text-amber-400 font-black">BUT</span>${buteurInfo}`;
    }
    else if (event.event_type.includes('penalty')) {
        label = "<span class='text-orange-500 font-black'>EXCLUSION 2'</span>"; icon = "✌️";
        team = event.event_type.includes('home') ? matchData.home_team : matchData.away_team;
    } 
    else if (isPeriod) {
        if (event.player_name === "Mi-Temps") { icon = "☕"; label = "Mi-Temps"; }
        else if (event.player_name === "2ème Période") { icon = "🏃"; label = "REPRISE DU MATCH"; }
        else if (event.player_name === "Match Terminé") { icon = "🏁"; label = "FIN DU MATCH"; }
        team = "INFO";
    }
    else if (event.event_type === 'comment') {
        label = `<span class="text-white italic font-medium">"${event.player_name}"</span>`; icon = "💬"; team = "DIRECT";
    }
    else if (event.event_type === 'gk_save') {
        label = "<span class='text-indigo-400 font-bold italic'>Arrêt Gardien (Stats)</span>"; icon = "🧤"; team = "SCHL";
    }
    else if (event.event_type === '7m_announced') {
        label = `<span class="text-amber-400 font-black">JET DE 7m</span> pour ${event.player_name}`; icon = "🎯"; team = "ARBITRAGE";
    }

    div.innerHTML = `
        <span class="score-font text-amber-500/50 text-[10px] w-9">${event.match_time}</span>
        <div class="flex-1 leading-tight">
            <div class="text-[8px] text-slate-500 uppercase font-black tracking-widest">${team}</div>
            <div class="text-xs font-bold text-slate-300">${label} <span class="text-slate-500 ml-1 text-[10px]">(${event.score_snapshot})</span></div>
        </div>
        <button class="admin-delete-btn" onclick="deleteEvent('${event.id}', '${event.event_type}')">Suppr.</button>
        <span class="text-lg">${icon}</span>
    `;
    container.prepend(div);
}

/**
 * CALCULS DES STATISTIQUES EN DIRECT
 */
function calculateStats() {
    // 1. STATS GARDIEN (Saves / (Saves + Buts encaissés))
    const saves = fullTimeline.filter(e => e.event_type === 'gk_save').length;
    const goalsConceded = fullTimeline.filter(e => e.event_type === 'goal_away').length;
    const totalShotsAgainst = saves + goalsConceded;
    const percent = totalShotsAgainst > 0 ? Math.round((saves / totalShotsAgainst) * 100) : 0;
    
    document.getElementById('stats-gk-percent').innerText = `${percent}%`;
    document.getElementById('stats-gk-details').innerText = `${saves} Arrêt${saves > 1 ? 's' : ''} / ${totalShotsAgainst} Tir${totalShotsAgainst > 1 ? 's' : ''}`;

    // 2. TOP BUTEURS (Compte les buts par joueur pour l'équipe Maison)
    const homeGoals = fullTimeline.filter(e => e.event_type === 'goal_home' && e.player_name);
    const counts = {};
    homeGoals.forEach(g => { counts[g.player_name] = (counts[g.player_name] || 0) + 1; });
    const sortedScorers = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const container = document.getElementById('stats-scorers');
    if (sortedScorers.length > 0) {
        container.innerHTML = sortedScorers.map(([name, count]) => `
            <div class="flex justify-between items-center border-b border-slate-800/50 pb-1">
                <span class="text-[11px] font-bold text-slate-300 truncate mr-2">${name}</span>
                <span class="score-font text-amber-400 text-xs">${count}</span>
            </div>
        `).join('');
    }
}

/**
 * FONCTIONS ADMIN - ACTIONS MATCH
 */
async function updateScore(col, inc) {
    if (inc > 0) {
        pendingGoalTeam = col;
        openPlayerModal(col); // Ouvre la modale pour choisir le buteur
    } else {
        const { data } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
        await supabaseClient.from('matches').update({ [col]: Math.max(0, data[col] - 1) }).eq('id', MATCH_ID);
    }
}

async function confirmGoal(playerName) {
    const col = pendingGoalTeam;
    const { data } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
    const newVal = data[col] + 1;
    await supabaseClient.from('matches').update({ [col]: newVal }).eq('id', MATCH_ID);

    const sH = col === 'score_home' ? newVal : matchData.score_home;
    const sA = col === 'score_away' ? newVal : matchData.score_away;

    await supabaseClient.from('timeline').insert({
        match_id: MATCH_ID,
        event_type: col === 'score_home' ? 'goal_home' : 'goal_away',
        match_time: document.getElementById('timer-display').innerText,
        score_snapshot: `${sH}-${sA}`,
        player_name: playerName
    });
    closeModal();
}

async function deleteEvent(eventId, type) {
    try {
        // Annuler les effets secondaires (Score et 2min)
        if (type === 'goal_home' || type === 'goal_away') {
            const col = type === 'goal_home' ? 'score_home' : 'score_away';
            const { data: match } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
            await supabaseClient.from('matches').update({ [col]: Math.max(0, match[col] - 1) }).eq('id', MATCH_ID);
        } 
        else if (type.includes('penalty')) {
            const team = type.includes('home') ? 'home' : 'away';
            const { data: p } = await supabaseClient.from('penalties').select('id').eq('match_id', MATCH_ID).eq('team', team).order('created_at', { ascending: false }).limit(1).single();
            if (p) await supabaseClient.from('penalties').delete().eq('id', p.id);
        }

        await supabaseClient.from('timeline').delete().eq('id', eventId);
        fullTimeline = fullTimeline.filter(e => e.id !== eventId); // Nettoyage local
        const element = document.getElementById(`event-${eventId}`);
        if (element) element.remove();
        calculateStats();
    } catch (err) { console.error(err); }
}

/**
 * GESTION DU CHRONO
 */
function getCurrentMatchSeconds() {
    if (!matchData) return 0;
    let t = matchData.timer_seconds;
    if (matchData.is_running && matchData.last_start_time) {
        t += Math.floor((new Date() - new Date(matchData.last_start_time)) / 1000);
    }
    return t;
}

function refreshTimers() {
    const s = getCurrentMatchSeconds();
    document.getElementById('timer-display').innerText = `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
    renderPenalties('home', s); 
    renderPenalties('away', s);
}

// Lancement au chargement
init();