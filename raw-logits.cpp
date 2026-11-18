#include "llama.h"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <sstream>
#include <string>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    ggml_backend_load_all_from_path(argv[2]);
    llama_backend_init();
    auto mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    auto *model = llama_model_load_from_file(argv[1], mp);
    if (!model) return 3;
    auto cp = llama_context_default_params();
    cp.n_ctx = 4096;
    cp.n_batch = 2048;
    cp.n_threads = 4;
    cp.n_threads_batch = 4;
    auto *ctx = llama_init_from_model(model, cp);
    if (!ctx) return 4;

    const auto *vocab = llama_model_get_vocab(model);
    const int vocab_size = llama_vocab_n_tokens(vocab);
    auto tokenize = [&](const std::string &s) {
        std::vector<llama_token> tokens(s.size() + 16);
        const int n = llama_tokenize(vocab, s.data(), s.size(), tokens.data(), tokens.size(), false, true);
        if (n < 1) throw std::runtime_error("tokenization failed");
        tokens.resize(n);
        return tokens;
    };
    std::vector<llama_token> old;
    std::string line;
    while (std::getline(std::cin, line)) {
        int option_count;
        size_t size;
        std::istringstream(line) >> size >> option_count;
        if (option_count < 2 || option_count > 4) return 6;
        std::string prompt(size, '\0');
        std::cin.read(prompt.data(), prompt.size());
        const auto tokens = tokenize(prompt);
        std::vector<llama_token> choices;
        for (int i = 0; i < option_count; ++i) {
            const auto candidate = tokenize(prompt + char('A' + i));
            if (candidate.size() != tokens.size() + 1 || !std::equal(tokens.begin(), tokens.end(), candidate.begin()))
                throw std::runtime_error("candidate must add exactly one token");
            choices.push_back(candidate.back());
        }
        size_t common = 0;
        while (common < old.size() && common + 1 < tokens.size() && old[common] == tokens[common]) ++common;
        auto memory = llama_get_memory(ctx);
        if (!llama_memory_seq_rm(memory, 0, common, -1)) {
            llama_memory_clear(memory, true);
            common = 0;
        }
        std::vector<llama_token> suffix(tokens.begin() + common, tokens.end());
        if (llama_decode(ctx, llama_batch_get_one(suffix.data(), suffix.size()))) return 5;
        const float *logits = llama_get_logits_ith(ctx, -1);
        const auto *top = std::max_element(logits, logits + vocab_size);
        double weight = 0;
        for (int i = 0; i < vocab_size; ++i) weight += std::exp(double(logits[i]) - *top);
        const double log_z = *top + std::log(weight);
        std::cout << std::setprecision(10) << "{\"logNormalizer\":" << log_z << ",\"topToken\":" << top - logits
                  << ",\"prefixTokens\":" << tokens.size() << ",\"tokens\":[";
        for (int i = 0; i < option_count; ++i) {
            if (i) std::cout << ',';
            std::cout << "{\"id\":" << choices[i] << ",\"logit\":" << logits[choices[i]]
                      << ",\"logProbability\":" << logits[choices[i]] - log_z << '}';
        }
        std::cout << "]}" << std::endl;
        old = tokens;
    }
    llama_free(ctx);
    llama_model_free(model);
    llama_backend_free();
}
